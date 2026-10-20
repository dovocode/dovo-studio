package expo.modules.dovoquestions

import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import com.google.firebase.messaging.RemoteMessage
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.io.File
import java.security.KeyStore
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.concurrent.thread

class DovoQuestionNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DovoQuestionNotifications")
    AsyncFunction("configure") { json: String ->
      QuestionVault.write(requireNotNull(appContext.reactContext), "connections", JSONObject(json))
    }
    AsyncFunction("getDraft") { runtimeId: String, id: String ->
      QuestionVault.draft(requireNotNull(appContext.reactContext), runtimeId, id)?.let {
        mapOf("fieldId" to it.getString("fieldId"), "value" to it.getString("value"))
      }
    }
    AsyncFunction("clearDraft") { runtimeId: String, id: String ->
      QuestionVault.saveDraft(requireNotNull(appContext.reactContext), runtimeId, id, null)
    }
  }
}

// AndroidKeyStore protects pairing tokens and unconfirmed answers. No credentials in push data.
private object QuestionVault {
  private const val alias = "dovo.question-notifications"
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  @Synchronized fun read(context: Context, name: String): JSONObject {
    val file = File(context.noBackupFilesDir, "dovo-question-$name")
    if (!file.exists() && !File(file.path + ".bak").exists()) return JSONObject()
    val data = AtomicFile(file).openRead().use { it.readBytes() }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0, 12)))
    return JSONObject(String(cipher.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8))
  }
  @Synchronized fun write(context: Context, name: String, value: JSONObject) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val encrypted = cipher.iv + cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
    val file = AtomicFile(File(context.noBackupFilesDir, "dovo-question-$name"))
    val stream = file.startWrite()
    try { stream.write(encrypted); file.finishWrite(stream) }
    catch (error: Exception) { file.failWrite(stream); throw error }
  }
  @Synchronized fun draft(context: Context, runtimeId: String, id: String): JSONObject? =
    read(context, "drafts").optJSONObject("$runtimeId\u0000$id")?.takeIf { it.optLong("expires") > System.currentTimeMillis() }

  @Synchronized fun saveDraft(context: Context, runtimeId: String, id: String, value: JSONObject?) {
    val drafts = read(context, "drafts")
    drafts.keys().asSequence().toList().forEach { if (drafts.getJSONObject(it).optLong("expires") <= System.currentTimeMillis()) drafts.remove(it) }
    if (value != null && !drafts.has("$runtimeId\u0000$id") && drafts.length() >= 20) drafts.keys().asSequence().minByOrNull { drafts.getJSONObject(it).optLong("expires") }?.let { drafts.remove(it) }
    if (value == null) drafts.remove("$runtimeId\u0000$id") else drafts.put("$runtimeId\u0000$id", value)
    write(context, "drafts", drafts)
  }
}

// FCM notification payloads bypass application code in the background. Actionable questions
// use high-priority data messages so this service can attach real controls, even after a cold start.
class QuestionMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = JSONObject(remoteMessage.data)
    if (data.optString("kind") == "input" && data.optString("inputType") == "question" && data.has("question")) {
      try {
        if (QuestionVault.read(this, "connections").has(data.getString("runtimeId"))) QuestionNotification.show(this, data)
      } catch (_: Exception) {
        QuestionNotification.show(this, data, "Open Dovo to answer this question.")
      }
    } else super.onMessageReceived(remoteMessage)
  }
}

private object QuestionNotification {
  private const val channel = "dovo-tasks"
  fun show(context: Context, data: JSONObject, failure: String? = null, sending: Boolean = false) {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(channel, "Dovo tasks", NotificationManager.IMPORTANCE_HIGH))
    val runtimeId = data.optString("runtimeId")
    val id = data.optString("inputId")
    val tag = data.optString("notificationId", "$runtimeId:$id")
    val uri = Uri.Builder().scheme("dovo").authority("thread").appendPath(runtimeId).appendPath(data.optString("taskId")).appendQueryParameter("questionId", id).build()
    val launch = requireNotNull(context.packageManager.getLaunchIntentForPackage(context.packageName)).apply {
      action = Intent.ACTION_VIEW; this.data = uri; addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val open = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val body = failure ?: if (sending) "Sending answer…" else data.optString("message")
    val builder = NotificationCompat.Builder(context, channel)
      .setSmallIcon(android.R.drawable.stat_notify_chat)
      .setContentTitle(if (failure != null) "Dovo · Answer needs attention" else data.optString("title", "Dovo question"))
      .setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
    if (failure != null || sending) builder.setSilent(true)
    if (failure == null && !sending) {
      val question = JSONObject(data.getString("question"))
      if (question.getString("mode") == "text") {
        builder.addAction(action(context, data, "dovo-reply", "Reply", true))
      } else {
        val choices = question.getJSONArray("choices")
        for (i in 0 until minOf(choices.length(), 3)) builder.addAction(action(context, data, "dovo-choice-$i", choices.getJSONObject(i).getString("label"), false))
      }
    }
    manager.notify(tag, 0, builder.build())
  }
  private fun action(context: Context, data: JSONObject, action: String, title: String, reply: Boolean): NotificationCompat.Action {
    val intent = Intent(context, QuestionAnswerReceiver::class.java).apply {
      this.action = action
      this.data = Uri.Builder().scheme("dovo-answer").authority("question").appendPath(data.getString("runtimeId")).appendPath(data.getString("inputId")).appendPath(action).build()
      putExtra("notification", data.toString())
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (reply) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
    val pending = PendingIntent.getBroadcast(context, 0, intent, flags)
    val builder = NotificationCompat.Action.Builder(0, title, pending)
    if (reply) builder.addRemoteInput(RemoteInput.Builder("answer").setLabel("Your answer").build())
    if (Build.VERSION.SDK_INT >= 31) builder.setAuthenticationRequired(true)
    return builder.build()
  }
}

class QuestionAnswerReceiver : BroadcastReceiver() {
  companion object { private val pending = ConcurrentHashMap.newKeySet<String>() }
  override fun onReceive(context: Context, intent: Intent) {
    val data = try { JSONObject(intent.getStringExtra("notification") ?: return) } catch (_: Exception) { return }
    val question = try { JSONObject(data.getString("question")) } catch (_: Exception) { return }
    val value = if (intent.action == "dovo-reply" && question.optString("mode") == "text") {
      RemoteInput.getResultsFromIntent(intent)?.getCharSequence("answer")?.toString()
    } else if (question.optString("mode") == "choice") {
      val index = intent.action?.removePrefix("dovo-choice-")?.toIntOrNull()
      index?.takeIf { it >= 0 }?.let { question.optJSONArray("choices")?.optJSONObject(it)?.optString("value") }
    } else null
    if (value.isNullOrBlank() || value.length > 10000) {
      QuestionNotification.show(context, data, "Enter an answer in Dovo."); return
    }
    val runtimeId = data.optString("runtimeId")
    val id = data.optString("inputId")
    val key = "$runtimeId\u0000$id"
    if (!pending.add(key)) return
    val result = goAsync()
    thread(name = "dovo-question-answer") {
      try {
        val fieldId = question.getString("fieldId")
        QuestionVault.saveDraft(context, runtimeId, id, JSONObject().put("fieldId", fieldId).put("value", value).put("expires", System.currentTimeMillis() + 86_400_000))
        check(!context.getSystemService(KeyguardManager::class.java).isDeviceLocked) { "Unlock Dovo to answer" }
        val config = QuestionVault.read(context, "connections").getJSONObject(runtimeId)
        val base = URI(config.getString("address"))
        check(base.scheme in listOf("http", "https") && base.host != null && base.userInfo == null)
        QuestionNotification.show(context, data, sending = true)
        val connection = base.resolve("/api/notifications/answer").toURL().openConnection() as HttpURLConnection
        try {
          connection.instanceFollowRedirects = false
          connection.connectTimeout = 4000
          connection.readTimeout = 6000
          connection.requestMethod = "POST"
          connection.setRequestProperty("Authorization", "Bearer " + config.getString("token"))
          connection.setRequestProperty("Content-Type", "application/json")
          connection.doOutput = true
          val input = JSONObject().put("taskId", data.getString("taskId")).put("id", id).put("fieldId", fieldId).put("value", value)
          connection.outputStream.use { it.write(input.toString().toByteArray(Charsets.UTF_8)) }
          val response = if (connection.responseCode == 200) connection.inputStream.bufferedReader().use { reader ->
            val buffer = CharArray(4096)
            var count = 0
            while (count < buffer.size) {
              val read = reader.read(buffer, count, buffer.size - count)
              if (read < 0) break
              count += read
            }
            if (count > 0) String(buffer, 0, count) else "{}"
          } else "{}"
          if (connection.responseCode == 200 && JSONObject(response).optBoolean("ok")) {
            QuestionVault.saveDraft(context, runtimeId, id, null)
            context.getSystemService(NotificationManager::class.java).cancel(data.optString("notificationId", "$runtimeId:$id"), 0)
          } else {
            QuestionNotification.show(context, data, if (connection.responseCode == 409) "Question changed or already answered. Open Dovo to check." else "Answer not confirmed. Open Dovo to review and send again.")
          }
        } finally { connection.disconnect() }
      } catch (_: Exception) {
        QuestionNotification.show(context, data, "Answer not confirmed. Open Dovo to check your connection and review your answer.")
      } finally { pending.remove(key); result.finish() }
    }
  }
}
