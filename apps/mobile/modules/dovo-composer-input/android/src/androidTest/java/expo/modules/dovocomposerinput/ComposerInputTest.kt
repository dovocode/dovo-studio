package expo.modules.dovocomposerinput

import android.graphics.Color
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.util.Base64
import java.io.ByteArrayOutputStream
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
  @Test fun sendSnapshotCommitsCompositionAndAcknowledgesAllNativeText() = onMain {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    // Exercise the native input without starting a JS runtime. Event forwarding is
    // covered by the JS adapter check; only the absent Expo proxy is stubbed here.
    val catalyst = java.lang.reflect.Proxy.newProxyInstance(
      com.facebook.react.bridge.CatalystInstance::class.java.classLoader,
      arrayOf(com.facebook.react.bridge.CatalystInstance::class.java)
    ) { _, method, _ ->
      check(method.name == "getNativeModule") { "Unexpected bridge call: ${method.name}" }
      null
    } as com.facebook.react.bridge.CatalystInstance
    val react = object : com.facebook.react.bridge.BridgeReactContext(context) {
      override fun getCatalystInstance() = catalyst
    }
    val modules = object : expo.modules.kotlin.ModulesProvider {
      override fun getModulesMap(): Map<Class<out expo.modules.kotlin.modules.Module>, String?> = emptyMap()
    }
    val appContext = expo.modules.kotlin.AppContext(modules, expo.modules.core.ModuleRegistry(emptyList(), emptyList()), java.lang.ref.WeakReference(react))
    val view = DovoComposerInputView(react, appContext)
    view.receive(ComposerContentRecord().apply { text = source; revision = "snapshot" })
    val input = view.getChildAt(0) as ComposerEditText
    input.setSelection(source.length)
    val connection = input.onCreateInputConnection(EditorInfo())!!
    connection.commitText(" complete 🚀", 1)
    connection.setComposingText("に", 1)
    val full = input.text.toString()
    val snapshot = view.readText()
    assertEquals(full, snapshot["text"])
    assertTrue(full.startsWith(source))
    assertTrue(full.endsWith("に"))
    assertEquals(-1, BaseInputConnection.getComposingSpanStart(input.text))
    assertEquals("snapshot", snapshot["revision"])
    val count = snapshot["eventCount"] as Int
    assertTrue(count > 0)
    view.receive(ComposerContentRecord().apply { text = ""; revision = "sent"; eventCount = count })
    assertEquals("", input.text.toString())
  }
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
  @Test fun sentMessageKeepsSourceSelectableWithoutEditingOrKeyboard() = onMain {
    val input = input()
    input.displayMessage(true)
    assertTrue(input.isEnabled)
    assertTrue(input.isTextSelectable)
    assertFalse(input.showSoftInputOnFocus)
    assertFalse(input.isCursorVisible)
    assertEquals(0, input.paddingTop + input.paddingBottom + input.paddingLeft + input.paddingRight)
    assertNull(input.onCreateInputConnection(EditorInfo()))
    input.setSelection(source.indexOf(" please"))
    input.onKeyDown(KeyEvent.KEYCODE_DEL, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DEL))
    assertEquals(source, input.text.toString())
    input.setSelection(0, source.length)
    assertEquals(source, input.text!!.subSequence(input.selectionStart, input.selectionEnd).toString())
  }
  @Test fun modelIconReservesSpaceAndUsesBrandOrThemeColor() = onMain {
    val image = Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888)
    image.eraseColor(Color.RED)
    val bytes = ByteArrayOutputStream()
    image.compress(Bitmap.CompressFormat.PNG, 100, bytes)
    val icon = Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 17f }
    val plain = ReferenceSpan("MODEL gpt", Color.LTGRAY, Color.BLUE, { 300f }, 1f)
    for (template in listOf(true, false)) {
      val span = ReferenceSpan("MODEL gpt", Color.LTGRAY, Color.BLUE, { 300f }, 1f, icon, template)
      assertEquals(20, span.getSize(paint, source, 0, source.length, null) - plain.getSize(paint, source, 0, source.length, null))
      val rendered = Bitmap.createBitmap(300, 60, Bitmap.Config.ARGB_8888)
      span.draw(Canvas(rendered), source, 0, source.length, 0f, 0, 30, 60, paint)
      val centerY = (30 + (paint.ascent() + paint.descent()) / 2).toInt()
      assertEquals(if (template) Color.BLUE else Color.RED, rendered.getPixel(15, centerY))
    }
  }
}
