package com.jackpham.doc_scanner

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.IOException
import kotlin.concurrent.thread

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // Copies finished PDFs into the shared Documents folder through
        // MediaStore, which needs no storage permission on Android 10+.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "doc_scanner/public_folder")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "isSupported" -> result.success(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                    "save" -> inBackground(result) {
                        save(
                            call.argument<String>("source")!!,
                            call.argument<String>("relativeDir")!!,
                            call.argument<String>("name")!!,
                        )
                    }
                    "delete" -> inBackground(result) {
                        delete(call.argument<String>("uri")!!)
                        null
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun inBackground(result: MethodChannel.Result, work: () -> Any?) {
        thread {
            try {
                val value = work()
                runOnUiThread { result.success(value) }
            } catch (e: Exception) {
                runOnUiThread { result.error("public_folder", e.message ?: e.toString(), null) }
            }
        }
    }

    private fun save(source: String, relativeDir: String, name: String): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            throw IOException("Saving to the phone folder needs Android 10 or newer")
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf")
            put(MediaStore.MediaColumns.RELATIVE_PATH, relativeDir)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = contentResolver.insert(collection, values)
            ?: throw IOException("Could not create $relativeDir/$name")
        try {
            val out = contentResolver.openOutputStream(uri)
                ?: throw IOException("Could not open $relativeDir/$name for writing")
            out.use { File(source).inputStream().use { input -> input.copyTo(out) } }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            contentResolver.update(uri, values, null, null)
        } catch (e: Exception) {
            contentResolver.delete(uri, null, null)
            throw e
        }
        return uri.toString()
    }

    private fun delete(uri: String) {
        try {
            contentResolver.delete(Uri.parse(uri), null, null)
        } catch (e: SecurityException) {
            // The file is no longer ours to delete (app data was restored onto
            // a fresh install, or the user moved it). Leave it in place.
        }
    }
}
