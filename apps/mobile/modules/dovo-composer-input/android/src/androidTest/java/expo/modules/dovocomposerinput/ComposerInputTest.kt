package expo.modules.dovocomposerinput

import android.graphics.Color
import android.text.Spanned
import android.view.KeyEvent
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ComposerInputTest {
  private val source = "🚀 Read @src/file.ts please"
  private fun input(): ComposerEditText {
    val input = ComposerEditText(InstrumentationRegistry.getInstrumentation().targetContext)
    input.setText(source)
    val start = source.indexOf('@')
    val end = source.indexOf(" please")
    input.text!!.setSpan(ReferenceSpan("FILE file.ts", Color.LTGRAY, Color.BLACK, { 300f }, 1f), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    return input
  }
  private fun onMain(check: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(check)
  @Test fun sourceAndSelectionStayInUtf16Coordinates() = onMain {
    val input = input()
    val start = source.indexOf('@')
    val end = source.indexOf(" please")
    assertEquals(source, input.text.toString())
    input.setSelection(start)
    input.setSelection(start + 2)
    assertEquals(end, input.selectionStart)
    input.setSelection(start + 1, end - 1)
    assertEquals(start, input.selectionStart)
    assertEquals(end, input.selectionEnd)
  }
  @Test fun hardwareBackspaceAndForwardDeleteRemoveTheWholeReference() = onMain {
    for (backward in listOf(true, false)) {
      val input = input()
      input.setSelection(if (backward) source.indexOf(" please") else source.indexOf('@'))
      val key = if (backward) KeyEvent.KEYCODE_DEL else KeyEvent.KEYCODE_FORWARD_DEL
      assertTrue(input.onKeyDown(key, KeyEvent(KeyEvent.ACTION_DOWN, key)))
      assertEquals("🚀 Read  please", input.text.toString())
    }
  }
  @Test fun softKeyboardDeletionRemovesTheWholeReference() = onMain {
    for (codePoints in listOf(true, false)) {
      val input = input()
      input.setSelection(source.indexOf(" please"))
      val connection = input.onCreateInputConnection(EditorInfo())!!
      if (codePoints) connection.deleteSurroundingTextInCodePoints(1, 0) else connection.deleteSurroundingText(1, 0)
      assertEquals("🚀 Read  please", input.text.toString())
    }
  }
  @Test fun compositionDoesNotRewriteExistingReferenceText() = onMain {
    val input = input()
    input.setSelection(source.length)
    val connection = input.onCreateInputConnection(EditorInfo())!!
    connection.setComposingText("に", 1)
    assertTrue(BaseInputConnection.getComposingSpanStart(input.text) >= 0)
    assertTrue(input.text.toString().startsWith(source))
    connection.finishComposingText()
    assertEquals(source + "に", input.text.toString())
  }
}
