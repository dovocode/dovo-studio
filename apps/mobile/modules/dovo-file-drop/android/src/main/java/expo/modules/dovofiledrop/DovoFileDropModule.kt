package expo.modules.dovofiledrop

import android.content.Context
import android.view.DragEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

class DovoFileDropModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DovoFileDrop")
    AsyncFunction("releaseFiles") { uris: List<String> ->
      val directory = File(appContext.reactContext!!.cacheDir, "dovo-file-drops").canonicalFile
      uris.forEach { value ->
        val uri = android.net.Uri.parse(value)
        if (uri.scheme == "file") {
          val file = File(uri.path ?: "").canonicalFile
          if (file.parentFile == directory && file.exists() && !file.delete())
            throw IllegalStateException("Could not remove dropped file")
        }
      }
    }
    View(DovoFileDropView::class) {
      Events("onFilesDropped", "onDropActive", "onDropError")
      Prop("enabled") { view: DovoFileDropView, value: Boolean -> view.enabled = value }
    }
  }
}

class DovoFileDropView(context: Context, private val dropContext: AppContext) : ExpoView(context, dropContext) {
  private val onFilesDropped by EventDispatcher()
  private val onDropActive by EventDispatcher()
  private val onDropError by EventDispatcher()
  var enabled = true
  private var receiving = false
  init {
    setOnDragListener { _, event ->
      when (event.action) {
        DragEvent.ACTION_DRAG_STARTED -> enabled && !receiving && event.clipDescription != null &&
          (event.clipDescription.hasMimeType("text/uri-list") || !event.clipDescription.hasMimeType("text/plain"))
        DragEvent.ACTION_DRAG_ENTERED -> { onDropActive(mapOf("active" to true)); true }
        DragEvent.ACTION_DRAG_EXITED, DragEvent.ACTION_DRAG_ENDED -> { onDropActive(mapOf("active" to false)); true }
        DragEvent.ACTION_DROP -> { receive(event); true }
        else -> true
      }
    }
  }
  private fun receive(event: DragEvent) {
    onDropActive(mapOf("active" to false))
    if (!enabled || receiving) return
    val clip = event.clipData ?: return
    if (clip.itemCount > 5) { onDropError(mapOf("message" to "Attach up to 5 files per message.")); return }
    val permission = dropContext.currentActivity?.requestDragAndDropPermissions(event)
    val uris = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
    if (uris.isEmpty()) { permission?.release(); onDropError(mapOf("message" to "Drop files rather than text.")); return }
    receiving = true
    val executor = Executors.newSingleThreadExecutor()
    executor.execute {
      val files = mutableListOf<Map<String, String>>()
      val errors = mutableListOf<String>()
      try {
        val resolver = context.contentResolver
        val directory = File(context.cacheDir, "dovo-file-drops").apply { mkdirs() }
        for (uri in uris) {
          var target: File? = null
          try {
            val mime = resolver.getType(uri) ?: "application/octet-stream"
            if (mime == "vnd.android.document/directory") throw IllegalArgumentException("Drop files rather than directories.")
            var name = uri.lastPathSegment ?: "attachment"
            resolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
              if (cursor.moveToFirst()) name = cursor.getString(0) ?: name
            }
            val isImage = mime.startsWith("image/") || name.substringAfterLast('.', "").lowercase() in setOf("png", "jpg", "jpeg", "webp", "heic", "heif", "gif")
            // Match the JS optimizer's 50 MB source bound and the 5 MB upload bound.
            val maxBytes = (if (isImage) 50 else 5) * 1024 * 1024
            val destination = File(directory, UUID.randomUUID().toString())
            target = destination
            resolver.openInputStream(uri)?.use { input ->
              destination.outputStream().use { output ->
                val buffer = ByteArray(8192)
                var total = 0
                while (true) {
                  val count = input.read(buffer)
                  if (count < 0) break
                  total += count
                  if (total > maxBytes) throw IllegalArgumentException(if (isImage) "Choose an image up to 50 MB to optimize." else "Each attachment must be 5 MB or smaller.")
                  output.write(buffer, 0, count)
                }
              }
            } ?: throw IllegalArgumentException("Could not read dropped file.")
            files.add(mapOf("uri" to android.net.Uri.fromFile(destination).toString(), "name" to name, "mimeType" to mime))
          } catch (error: Exception) {
            target?.let { file -> if (file.exists() && !file.delete()) errors.add("Could not remove temporary dropped file.") }
            errors.add(error.message ?: "Could not read dropped file.")
          }
        }
      } finally {
        permission?.release()
        post {
          receiving = false
          if (!isAttachedToWindow) {
            files.forEach { file ->
              val temporary = File(android.net.Uri.parse(file.getValue("uri")).path!!)
              if (temporary.exists() && !temporary.delete()) android.util.Log.e("DovoFileDrop", "Could not remove abandoned drop")
            }
            return@post
          }
          if (files.isNotEmpty()) onFilesDropped(mapOf("files" to files))
          if (errors.isNotEmpty()) onDropError(mapOf("message" to errors.joinToString("\n")))
        }
        executor.shutdown()
      }
    }
  }
}
