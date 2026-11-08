package expo.modules.dovoshareinbox

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

// Capture runs before Expo rewrites SEND into VIEW. Both files and the handoff ID survive JS death.
object DovoShareInbox {
  private const val ID = "com.dovo.studio.shareId"
  private const val BUDGET = 50L * 1024 * 1024
  private fun root(context: Context) = File(context.filesDir, "dovo-share-inbox").apply { mkdirs() }

  @JvmStatic @Synchronized fun capture(context: Context, intent: Intent?, restoredId: String? = null) {
    if (intent == null || intent.action !in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return
    // Extras belong to an untrusted sender. Only Activity saved state may restore our UUID.
    val id = restoredId?.takeIf { candidate ->
      runCatching { UUID.fromString(candidate).toString().equals(candidate, ignoreCase = true) }.getOrDefault(false)
    } ?: UUID.randomUUID().toString()
    intent.putExtra(ID, id)
    if (context.getSharedPreferences("dovo-share-receipts", Context.MODE_PRIVATE).getBoolean(id, false)) return
    val directory = File(root(context), id)
    if (File(directory, "handoff.json").exists()) return
    if (directory.exists()) check(directory.deleteRecursively()) { "Could not remove interrupted share." }
    check(directory.mkdirs()) { "Could not create shared draft storage." }
    val payloads = JSONArray()
    var issue: String? = null
    try {
      intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.let {
        payloads.put(JSONObject().put("shareType", "text").put("value", it))
      }
      @Suppress("DEPRECATION")
      val streams = if (intent.action == Intent.ACTION_SEND_MULTIPLE)
        intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.toList() ?: emptyList()
      else listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
      val uris = (streams + (0 until (intent.clipData?.itemCount ?: 0)).mapNotNull { intent.clipData?.getItemAt(it)?.uri }).distinct()
      require(uris.size <= 5) { "Attach up to 5 files per message." }
      var remaining = BUDGET - root(context).walkTopDown().filter { it.isFile }.sumOf { it.length() }
      uris.forEachIndexed { index, uri ->
        // External callers must grant provider access. A file:// URI would be opened as Dovo
        // and could name app-private data that the sending app cannot itself read.
        require(uri.scheme == "content") { "Share files using a content provider. Direct file addresses are not supported." }
        val resolver = context.contentResolver
        var name = uri.lastPathSegment ?: "attachment"
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) name = cursor.getString(0) ?: name
        }
        val target = File(directory, "file-$index")
        resolver.openInputStream(uri)?.use { input ->
          target.outputStream().use { output ->
            val buffer = ByteArray(8192)
            while (true) {
              val count = input.read(buffer)
              if (count < 0) break
              remaining -= count
              require(remaining >= 0) { "Shared drafts can use up to 50 MB. Open or discard a saved share first." }
              output.write(buffer, 0, count)
            }
            output.fd.sync()
          }
        } ?: error("Could not read shared file.")
        payloads.put(JSONObject().put("shareType", "file").put("value", Uri.fromFile(target).toString())
          .put("name", name).put("mimeType", resolver.getType(uri) ?: intent.type ?: "application/octet-stream"))
      }
    } catch (cause: Exception) {
      var cleanupFailed = false
      directory.listFiles()?.forEach { if (!it.delete()) cleanupFailed = true }
      issue = (cause.message ?: "Could not save shared files.") +
        if (cleanupFailed) " Could not remove the incomplete copy; discard this share to retry." else ""
    }
    val manifest = JSONObject().put("id", id).put("payloads", if (issue == null) payloads else JSONArray())
    if (issue != null) manifest.put("error", issue)
    val temporary = File(directory, "handoff.tmp")
    temporary.outputStream().use { it.write(manifest.toString().toByteArray()); it.fd.sync() }
    check(temporary.renameTo(File(directory, "handoff.json"))) { "Could not save shared draft." }
  }

  @Synchronized fun pending(context: Context): String = JSONArray().also { result ->
    root(context).listFiles()?.sortedBy { it.lastModified() }?.forEach { originalDirectory ->
      val originalManifest = File(originalDirectory, "handoff.json")
      if (!originalManifest.exists()) {
        check(originalDirectory.deleteRecursively()) { "Could not remove interrupted share." }
        return@forEach
      }
      // The directory is the ownership boundary; never trust an ID from manifest contents.
      val validId = runCatching {
        UUID.fromString(originalDirectory.name).toString().equals(originalDirectory.name, ignoreCase = true)
      }.getOrDefault(false)
      val directory = if (validId) originalDirectory else File(root(context), UUID.randomUUID().toString()).also {
        check(originalDirectory.renameTo(it)) { "Could not isolate damaged share." }
      }
      val envelope = JSONObject().put("id", directory.name)
      try {
        // JSON is parsed per handoff in JS. Corrupt bytes remain untouched until explicit discard.
        envelope.put("manifest", File(directory, "handoff.json").readText())
      } catch (cause: Exception) {
        envelope.put("error", "This saved share could not be read. Discard it and share the content again.")
      }
      result.put(envelope)
    }
  }.toString()

  @Synchronized fun acknowledge(context: Context, id: String) {
    require(runCatching { UUID.fromString(id) }.isSuccess) { "Invalid share ID" }
    check(context.getSharedPreferences("dovo-share-receipts", Context.MODE_PRIVATE).edit().putBoolean(id, true).commit()) {
      "Could not acknowledge incoming share."
    }
    val directory = File(root(context), id)
    check(!directory.exists() || directory.deleteRecursively()) { "Could not clear incoming share." }
  }
}

class DovoShareInboxModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DovoShareInbox")
    AsyncFunction("pending") { DovoShareInbox.pending(appContext.reactContext!!) }
    AsyncFunction("acknowledge") { id: String -> DovoShareInbox.acknowledge(appContext.reactContext!!, id) }
  }
}
