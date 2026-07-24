package expo.modules.rycodevicekey

import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

/**
 * StrongBox-backed P-256 key used to sign DPoP proofs for the hosted plane.
 *
 * The private key is generated inside the Android keystore, is non-exportable,
 * and never crosses into JS — this module exposes no export path by design. If
 * StrongBox is unavailable, key creation fails closed rather than falling back
 * to a software or TEE-only key; a weaker key would collapse DPoP down to bare
 * bearer assurance.
 */
class RycoDeviceKeyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RycoDeviceKey")

    AsyncFunction("ensureKey") {
      // Never accept a key we cannot prove is StrongBox-backed. A key already
      // present at this alias — left by an earlier build — may be TEE-only, and
      // `setIsStrongBoxBacked(true)` only constrains keys we create.
      var entry = loadPrivateKey()
      if (entry != null && backingOf(entry) != BACKING_STRONGBOX) {
        keyStore().deleteEntry(KEY_ALIAS)
        entry = null
      }
      val resolved = entry ?: createKey()
      val backing = backingOf(resolved)
      if (backing != BACKING_STRONGBOX) throw StrongBoxUnsupportedException()
      mapOf(
        "publicKey" to encodePublicKey(),
        "backing" to backing,
      )
    }

    AsyncFunction("sign") { payloadBase64: String ->
      val payload =
        try {
          Base64.decode(payloadBase64, Base64.NO_WRAP)
        } catch (cause: IllegalArgumentException) {
          throw MalformedPayloadException()
        }
      val privateKey = loadPrivateKey() ?: throw KeyMissingException()
      val signature =
        Signature.getInstance(SIGNATURE_ALGORITHM).run {
          initSign(privateKey)
          update(payload)
          sign()
        }
      Base64.encodeToString(signature, Base64.NO_WRAP)
    }

    AsyncFunction("hasKey") { loadPrivateKey() != null }

    AsyncFunction("deleteKey") { keyStore().deleteEntry(KEY_ALIAS) }
  }

  private fun keyStore(): KeyStore =
    KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

  private fun loadPrivateKey(): PrivateKey? =
    try {
      keyStore().getKey(KEY_ALIAS, null) as? PrivateKey
    } catch (cause: Exception) {
      throw KeystoreUnavailableException()
    }

  private fun createKey(): PrivateKey {
    val builder =
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec(CURVE))
        .setDigests(KeyProperties.DIGEST_SHA256)
        // A DPoP proof is minted on every authenticated request, so requiring
        // user authentication per use would prompt the user continuously.
        .setUserAuthenticationRequired(false)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      builder.setIsStrongBoxBacked(true)
    } else {
      // StrongBox is only expressible from API 28; below it the hardware
      // guarantee cannot be requested, so refuse rather than silently weaken.
      throw StrongBoxUnsupportedException()
    }

    return try {
      KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
        .apply { initialize(builder.build()) }
        .generateKeyPair()
        .private
    } catch (cause: StrongBoxUnavailableException) {
      throw StrongBoxUnsupportedException()
    }
  }

  /**
   * Report the keystore's own view of where the key lives, so the app can
   * render an accurate state rather than trusting the request we made.
   */
  private fun backingOf(privateKey: PrivateKey): String {
    val keyInfo =
      try {
        KeyFactory.getInstance(privateKey.algorithm, ANDROID_KEYSTORE)
          .getKeySpec(privateKey, KeyInfo::class.java)
      } catch (cause: Exception) {
        return BACKING_UNAVAILABLE
      }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return when (keyInfo.securityLevel) {
        KeyProperties.SECURITY_LEVEL_STRONGBOX -> BACKING_STRONGBOX
        else -> BACKING_UNAVAILABLE
      }
    }
    // Below API 31 the keystore reports only "inside secure hardware", which is
    // true for TEE-only keys as well as StrongBox ones — it cannot distinguish
    // them. Requiring the StrongBox system feature as well means a device
    // without StrongBox can never be reported as having it; on a device that
    // does have it, `setIsStrongBoxBacked(true)` would have thrown at creation
    // otherwise, and a pre-existing key that fails this check is deleted and
    // regenerated by `ensureKey` rather than trusted.
    @Suppress("DEPRECATION")
    val insideSecureHardware = keyInfo.isInsideSecureHardware
    val hasStrongBox =
      appContext.reactContext?.packageManager?.hasSystemFeature(
        PackageManager.FEATURE_STRONGBOX_KEYSTORE,
      ) == true
    return if (insideSecureHardware && hasStrongBox) BACKING_STRONGBOX else BACKING_UNAVAILABLE
  }

  /** X9.63 uncompressed point (`0x04 ‖ X(32) ‖ Y(32)`) for the public half only. */
  private fun encodePublicKey(): String {
    val certificate =
      keyStore().getCertificate(KEY_ALIAS) ?: throw PublicKeyUnavailableException()
    val publicKey = certificate.publicKey as? ECPublicKey ?: throw PublicKeyUnavailableException()
    val point = publicKey.w
    val encoded = ByteArray(1 + COORDINATE_BYTES * 2)
    encoded[0] = UNCOMPRESSED_PREFIX
    writeCoordinate(point.affineX, encoded, 1)
    writeCoordinate(point.affineY, encoded, 1 + COORDINATE_BYTES)
    return Base64.encodeToString(encoded, Base64.NO_WRAP)
  }

  /**
   * `BigInteger.toByteArray` is two's-complement: it prepends a zero byte when
   * the high bit is set and drops leading zeros otherwise, so the value must be
   * right-aligned into a fixed 32-byte field. Emitting it verbatim would change
   * the JWK thumbprint and invalidate every proof after login.
   */
  private fun writeCoordinate(value: BigInteger, destination: ByteArray, offset: Int) {
    val bytes = value.toByteArray()
    val start = if (bytes.size > COORDINATE_BYTES) bytes.size - COORDINATE_BYTES else 0
    val length = bytes.size - start
    if (length > COORDINATE_BYTES) throw PublicKeyUnavailableException()
    bytes.copyInto(destination, offset + COORDINATE_BYTES - length, start, bytes.size)
  }

  private companion object {
    /** Stable across releases: changing it orphans the key and forces re-login. */
    const val KEY_ALIAS = "dev.ryco.hostedhub.dpop.p256"
    const val ANDROID_KEYSTORE = "AndroidKeyStore"
    const val CURVE = "secp256r1"
    const val SIGNATURE_ALGORITHM = "SHA256withECDSA"
    const val COORDINATE_BYTES = 32
    const val UNCOMPRESSED_PREFIX: Byte = 0x04
    const val BACKING_STRONGBOX = "strongbox"
    const val BACKING_UNAVAILABLE = "unavailable"
  }
}

/**
 * Bounded errors. Messages are fixed strings so no key material, payload, or
 * unbounded platform detail reaches JS.
 */
private class StrongBoxUnsupportedException :
  CodedException("StrongBox is unavailable on this device.")

private class KeystoreUnavailableException :
  CodedException("The device key could not be read from the keystore.")

private class KeyMissingException : CodedException("No device key exists.")

private class PublicKeyUnavailableException :
  CodedException("The device public key could not be read.")

private class MalformedPayloadException : CodedException("The signing payload was malformed.")
