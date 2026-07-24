package expo.modules.rycoreviewdiff

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RycoReviewDiffModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RycoReviewDiffSurface")

    View(RycoReviewDiffView::class) {
      Prop("tokensResetKey") { view: RycoReviewDiffView, tokensResetKey: String ->
        view.setTokensResetKey(tokensResetKey)
      }
      Prop("contentResetKey") { view: RycoReviewDiffView, contentResetKey: String ->
        view.setContentResetKey(contentResetKey)
      }
      Prop("collapsedFileIdsJson") { view: RycoReviewDiffView, collapsedFileIdsJson: String ->
        view.setCollapsedFileIdsJson(collapsedFileIdsJson)
      }
      Prop("viewedFileIdsJson") { view: RycoReviewDiffView, viewedFileIdsJson: String ->
        view.setViewedFileIdsJson(viewedFileIdsJson)
      }
      Prop("selectedRowIdsJson") { view: RycoReviewDiffView, selectedRowIdsJson: String ->
        view.setSelectedRowIdsJson(selectedRowIdsJson)
      }
      Prop("collapsedCommentIdsJson") { view: RycoReviewDiffView, collapsedCommentIdsJson: String ->
        view.setCollapsedCommentIdsJson(collapsedCommentIdsJson)
      }
      Prop("appearanceScheme") { view: RycoReviewDiffView, appearanceScheme: String ->
        view.setAppearanceScheme(appearanceScheme)
      }
      Prop("themeJson") { view: RycoReviewDiffView, themeJson: String ->
        view.setThemeJson(themeJson)
      }
      Prop("styleJson") { view: RycoReviewDiffView, styleJson: String ->
        view.setStyleJson(styleJson)
      }
      Prop("rowHeight") { view: RycoReviewDiffView, rowHeight: Double ->
        view.setRowHeight(rowHeight.toFloat())
      }
      Prop("contentWidth") { view: RycoReviewDiffView, contentWidth: Double ->
        view.setContentWidth(contentWidth.toFloat())
      }
      Prop("initialRowIndex") { view: RycoReviewDiffView, initialRowIndex: Double ->
        view.setInitialRowIndex(initialRowIndex)
      }

      Events(
        "onDebug",
        "onVisibleFileChange",
        "onToggleFile",
        "onToggleViewedFile",
        "onPressLine",
        "onToggleComment",
      )

      AsyncFunction("scrollToFile") { view: RycoReviewDiffView, fileId: String, animated: Boolean ->
        view.scrollToFile(fileId, animated)
      }
      AsyncFunction("scrollToTop") { view: RycoReviewDiffView, animated: Boolean ->
        view.scrollToTop(animated)
      }
      AsyncFunction("setRowsJson") { view: RycoReviewDiffView, rowsJson: String ->
        view.setRowsJson(rowsJson)
      }
      AsyncFunction("setTokensJson") { view: RycoReviewDiffView, tokensJson: String ->
        view.setTokensJson(tokensJson)
      }
      AsyncFunction("setTokensPatchJson") { view: RycoReviewDiffView, tokensPatchJson: String ->
        view.setTokensPatchJson(tokensPatchJson)
      }

      OnViewDestroys { view: RycoReviewDiffView ->
        view.cleanup()
      }
    }
  }
}
