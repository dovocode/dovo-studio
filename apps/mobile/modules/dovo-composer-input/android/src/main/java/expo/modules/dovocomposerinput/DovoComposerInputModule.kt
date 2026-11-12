package expo.modules.dovocomposerinput

import android.content.Context
import android.graphics.Canvas
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.util.Base64
import android.text.Editable
import android.text.Spanned
import android.text.TextUtils
import android.text.TextWatcher
import android.text.style.ReplacementSpan
import android.view.Gravity
import android.view.KeyEvent
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import java.lang.ref.WeakReference
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

class ComposerReferenceRecord : Record {
  @Field var start: Int = 0
  @Field var end: Int = 0
  @Field var kind: String = ""
  @Field var label: String = ""
  @Field var icon: String = ""
  @Field var iconTemplate: Boolean = true
}
class ComposerContentRecord : Record {
  @Field var text: String = ""
  @Field var revision: String = ""
  @Field var eventCount: Int = 0
  @Field var references: List<ComposerReferenceRecord> = emptyList()
}
class DovoComposerInputModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DovoComposerInput")
    AsyncFunction("blur") {
      DovoComposerInputView.active?.get()?.let { view -> view.post { view.blur() } }
    }
    View(DovoComposerInputView::class) {
      Events("onTextChange", "onSourceSelection", "onFocus", "onBlur", "onSize")
      Prop("content") { view: DovoComposerInputView, content: ComposerContentRecord -> view.receive(content) }
      Prop("editable") { view: DovoComposerInputView, value: Boolean -> view.input.isEnabled = value }
      Prop("placeholder") { view: DovoComposerInputView, value: String -> view.input.hint = value }
      Prop("focusKey") { view: DovoComposerInputView, value: String -> view.focus(value) }
      Prop("textColor") { view: DovoComposerInputView, value: Color -> view.input.setTextColor(value.toArgb()); view.decorate() }
      Prop("mutedColor") { view: DovoComposerInputView, value: Color -> view.input.setHintTextColor(value.toArgb()) }
      Prop("chipColor") { view: DovoComposerInputView, value: Color -> view.chipColor = value.toArgb(); view.decorate() }
    }
  }
}

class ReferenceSpan(private val title: String, private val background: Int, private val foreground: Int,
  private val maximumWidth: () -> Float, private val density: Float,
  icon: String = "", private val iconTemplate: Boolean = true) : ReplacementSpan() {
  private val glyph = if (icon.isEmpty()) null else {
    val bytes = Base64.decode(icon, Base64.DEFAULT)
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
  }
  private val iconWidth = if (glyph == null) 0f else 20 * density
  private fun width(paint: Paint) = min(max(30f * density, maximumWidth()), paint.measureText(title) + 14 * density + iconWidth)
  override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int = ceil(width(paint)).toInt()
  override fun draw(canvas: Canvas, text: CharSequence, start: Int, end: Int, x: Float,
    top: Int, y: Int, bottom: Int, paint: Paint) {
    val color = paint.color
    val width = width(paint)
    paint.color = background
    canvas.drawRoundRect(RectF(x, y + paint.ascent() - 2 * density, x + width, y + paint.descent() + 2 * density), 5 * density, 5 * density, paint)
    paint.color = foreground
    glyph?.let { image ->
      val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
      if (iconTemplate) iconPaint.colorFilter = PorterDuffColorFilter(foreground, PorterDuff.Mode.SRC_IN)
      val iconTop = y + (paint.ascent() + paint.descent() - 16 * density) / 2
      canvas.drawBitmap(image, null, RectF(x + 7 * density, iconTop, x + 23 * density, iconTop + 16 * density), iconPaint)
    }
    val label = TextUtils.ellipsize(title, android.text.TextPaint(paint), max(1f, width - 14 * density - iconWidth), TextUtils.TruncateAt.END).toString()
    canvas.drawText(label, x + 7 * density + iconWidth, y.toFloat(), paint)
    paint.color = color
  }
}

class ComposerEditText(context: Context) : EditText(context) {
  var selectionChanged: (() -> Unit)? = null
  private var snapping = false
  private var previousStart = 0
  override fun onSelectionChanged(start: Int, end: Int) {
    super.onSelectionChanged(start, end)
    if (snapping || start < 0 || end < 0) return
    val value = text ?: return
    var from = start
    var to = end
    value.getSpans(0, value.length, ReferenceSpan::class.java).forEach { span ->
      val left = value.getSpanStart(span); val right = value.getSpanEnd(span)
      if (start == end && start > left && start < right) {
        from = if (start >= previousStart) right else left; to = from
      } else {
        if (from > left && from < right) from = left
        if (to > left && to < right) to = right
      }
    }
    if (from != start || to != end) {
      snapping = true
      setSelection(from, to)
      snapping = false
    }
    previousStart = from
    selectionChanged?.invoke()
  }
  private fun deleteReference(backward: Boolean): Boolean {
    val value = text ?: return false
    if (selectionStart != selectionEnd) return false
    val cursor = selectionStart
    val span = value.getSpans(0, value.length, ReferenceSpan::class.java).firstOrNull {
      if (backward) value.getSpanEnd(it) == cursor else value.getSpanStart(it) == cursor
    } ?: return false
    value.delete(value.getSpanStart(span), value.getSpanEnd(span))
    return true
  }
  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if ((keyCode == KeyEvent.KEYCODE_DEL || keyCode == KeyEvent.KEYCODE_FORWARD_DEL) &&
      deleteReference(keyCode == KeyEvent.KEYCODE_DEL)) return true
    return super.onKeyDown(keyCode, event)
  }
  override fun onCreateInputConnection(info: EditorInfo): InputConnection? {
    val connection = super.onCreateInputConnection(info) ?: return null
    return object : InputConnectionWrapper(connection, true) {
      override fun deleteSurroundingText(before: Int, after: Int): Boolean {
        if (before == 1 && after == 0 && deleteReference(true)) return true
        if (before == 0 && after == 1 && deleteReference(false)) return true
        return super.deleteSurroundingText(before, after)
      }
      override fun deleteSurroundingTextInCodePoints(before: Int, after: Int): Boolean {
        if (before == 1 && after == 0 && deleteReference(true)) return true
        if (before == 0 && after == 1 && deleteReference(false)) return true
        return super.deleteSurroundingTextInCodePoints(before, after)
      }
      override fun finishComposingText(): Boolean {
        val result = super.finishComposingText()
        post { selectionChanged?.invoke() }
        return result
      }
    }
  }
}

class DovoComposerInputView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  companion object { var active: WeakReference<DovoComposerInputView>? = null }
  val input = ComposerEditText(context)
  var chipColor = Color.LTGRAY
  private val onTextChange by EventDispatcher()
  private val onSourceSelection by EventDispatcher()
  private val onFocus by EventDispatcher()
  private val onBlur by EventDispatcher()
  private val onSize by EventDispatcher()
  private var eventCount = 0
  private var revision: String? = null
  private var pending: ComposerContentRecord? = null
  private var changing = false
  private var focusKey = ""
  private var lastHeight = 0
  private val density = resources.displayMetrics.density
  init {
    input.background = null
    input.textSize = 17f
    input.gravity = Gravity.TOP or Gravity.START
    input.setPadding((12 * density).toInt(), (11 * density).toInt(), (12 * density).toInt(), (11 * density).toInt())
    input.inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE or android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
    input.setSingleLine(false)
    input.isVerticalScrollBarEnabled = true
    input.contentDescription = "Message"
    input.setOnFocusChangeListener { _, focused ->
      if (focused) { active = WeakReference(this); onFocus(emptyMap<String, Any>()) }
      else { if (active?.get() === this) active = null; onBlur(emptyMap<String, Any>()) }
    }
    input.selectionChanged = {
      if (!changing) {
        onSourceSelection(mapOf("start" to max(0, input.selectionStart), "end" to max(0, input.selectionEnd)))
        decorate()
      }
    }
    input.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
      override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
      override fun afterTextChanged(value: Editable?) {
        if (!changing) {
          eventCount++
          onTextChange(mapOf("text" to value.toString(), "eventCount" to eventCount))
          post { measureContent() }
        }
      }
    })
    addView(input, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    input.layout(0, 0, right - left, bottom - top)
    measureContent()
  }
  fun focus(key: String) {
    if (key.isEmpty() || key == focusKey) return
    focusKey = key
    post {
      input.requestFocus()
      (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    }
  }
  fun blur() {
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(input.windowToken, 0)
    input.clearFocus()
  }
  fun receive(content: ComposerContentRecord) {
    if (content.eventCount < eventCount) return
    pending = content
    if (BaseInputConnection.getComposingSpanStart(input.text) >= 0) return
    if (revision != content.revision) {
      revision = content.revision
      if (input.text.toString() != content.text) {
        changing = true
        input.setText(content.text)
        input.setSelection(content.text.length)
        changing = false
      }
    }
    decorate()
  }
  fun decorate() {
    val content = pending ?: return
    val value = input.text ?: return
    if (changing || value.toString() != content.text || BaseInputConnection.getComposingSpanStart(value) >= 0) return
    changing = true
    value.getSpans(0, value.length, ReferenceSpan::class.java).forEach { value.removeSpan(it) }
    var end = 0
    content.references.forEach { reference ->
      if (reference.start >= end && reference.end > reference.start && reference.end <= value.length) {
        value.setSpan(ReferenceSpan(reference.label, chipColor, input.currentTextColor,
          { max(30f * density, input.width - input.paddingLeft - input.paddingRight.toFloat()) }, density,
          reference.icon, reference.iconTemplate), reference.start, reference.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        end = reference.end
      }
    }
    changing = false
    input.requestLayout()
    post { measureContent() }
  }
  private fun measureContent() {
    val layout = input.layout ?: return
    val next = layout.height + input.paddingTop + input.paddingBottom
    if (lastHeight != next) { lastHeight = next; onSize(mapOf("height" to next / density)) }
  }
}
