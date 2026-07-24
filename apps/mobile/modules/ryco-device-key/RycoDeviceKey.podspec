require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'RycoDeviceKey'
  s.version = package['version']
  s.summary = 'Secure Enclave P-256 device key for Ryco hosted DPoP sessions.'
  s.description = 'Creates and uses a non-exportable Secure Enclave P-256 key to sign DPoP proofs. The private key never leaves the enclave and the module exposes no export path.'
  s.homepage = 'https://ryco.dev'
  s.license = { :type => 'UNLICENSED' }
  s.author = { 'Ryco' => 'hello@ryco.dev' }
  s.platforms = { :ios => '16.1' }
  s.source = { :path => '.' }
  s.source_files = 'ios/**/*.{h,m,mm,swift}'
  s.frameworks = 'Security', 'LocalAuthentication'
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
end
