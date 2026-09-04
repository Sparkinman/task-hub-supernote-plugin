package com.taskhub

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Environment
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Persists Task Hub's settings as a JSON file in user-visible storage.
 *
 * Deliberately writes to Document/TaskHub/ rather than the plugin's private
 * directory: the private directory is removed when the plugin is uninstalled or
 * updated, which is exactly the case this exists to survive.
 *
 * The file is plain text on shared storage — readable over USB by anything with
 * access to the device. It is not a keystore, and a plugin has no access to one.
 * Prefer a Radicale credential scoped to the collections in use over an account
 * password.
 *
 * sn-plugin-lib has no general file I/O (PluginFileAPI is note-specific), which
 * is why this ~60 lines exists instead of an SDK call.
 */
class SettingsStoreModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  private fun storeDir(): File = File(Environment.getExternalStorageDirectory(), STORE_DIR)

  private fun storeFile(): File = File(storeDir(), STORE_FILE)

  /** Resolves to the file's contents, or null when nothing has been saved yet. */
  @ReactMethod
  fun read(promise: Promise) {
    try {
      val file = storeFile()
      if (!file.exists() || !file.canRead()) {
        promise.resolve(null)
        return
      }
      promise.resolve(file.readText(Charsets.UTF_8))
    } catch (e: Exception) {
      // A denied FILE:READ surfaces here as a SecurityException; report it
      // rather than resolving null, which would look like "nothing saved".
      promise.reject("READ_FAILED", e.message ?: "Could not read settings", e)
    }
  }

  /** Resolves to the absolute path written, so the UI can show where it went. */
  @ReactMethod
  fun write(contents: String, promise: Promise) {
    try {
      val dir = storeDir()
      if (!dir.exists() && !dir.mkdirs()) {
        promise.reject("WRITE_FAILED", "Could not create ${dir.absolutePath}")
        return
      }
      val file = storeFile()
      file.writeText(contents, Charsets.UTF_8)
      promise.resolve(file.absolutePath)
    } catch (e: Exception) {
      promise.reject("WRITE_FAILED", e.message ?: "Could not write settings", e)
    }
  }

  /**
   * Composes the image a page mark links to: the logo, large, with a caption.
   *
   * Drawn natively rather than shipped as a finished PNG because the caption has
   * to be legible at whatever size the device's image viewer shows, and scaling
   * up a small bitmap with baked-in text does not survive that. The logo is
   * decoded from base64, scaled to the canvas width, and the caption drawn
   * beneath it in a size proportional to the canvas.
   *
   * Overwrites any existing file: the caption and dimensions change between
   * versions, and a stale image would silently outlive them.
   */
  @ReactMethod
  fun writeLinkImage(relativePath: String, base64: String, caption: String, promise: Promise) {
    try {
      val file = File(Environment.getExternalStorageDirectory(), relativePath)
      val parent = file.parentFile
      if (parent != null && !parent.exists() && !parent.mkdirs()) {
        promise.reject("WRITE_FAILED", "Could not create " + parent.absolutePath)
        return
      }

      val raw = Base64.decode(base64, Base64.DEFAULT)
      val logo = BitmapFactory.decodeByteArray(raw, 0, raw.size)
          ?: run {
            promise.reject("WRITE_FAILED", "Could not decode the logo")
            return
          }

      // Generous canvas: the viewer scales to fit, so a large source keeps both
      // the mark and the caption crisp rather than interpolated.
      val width = CANVAS_WIDTH
      val margin = width / 10
      val logoWidth = width - margin * 2
      val logoHeight = (logoWidth.toFloat() * logo.height / logo.width).toInt()

      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.BLACK
        textSize = width / 20f
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
      }

      val lines = wrap(caption, paint, logoWidth.toFloat())
      val lineHeight = paint.fontSpacing
      val captionHeight = (lineHeight * lines.size).toInt()
      val height = margin + logoHeight + margin / 2 + captionHeight + margin

      val canvas = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      Canvas(canvas).apply {
        // White rather than transparent: an e-ink viewer over a dark background
        // would otherwise render black-on-black.
        drawColor(android.graphics.Color.WHITE)
        drawBitmap(
            Bitmap.createScaledBitmap(logo, logoWidth, logoHeight, true),
            margin.toFloat(),
            margin.toFloat(),
            null,
        )
        var y = (margin + logoHeight + margin / 2).toFloat() - paint.ascent()
        for (line in lines) {
          drawText(line, width / 2f, y, paint)
          y += lineHeight
        }
      }

      file.outputStream().use { out ->
        canvas.compress(Bitmap.CompressFormat.PNG, 100, out)
      }
      promise.resolve(file.absolutePath)
    } catch (e: Exception) {
      promise.reject("WRITE_FAILED", e.message ?: "Could not write the link image", e)
    }
  }

  /** Greedy word wrap, so a longer caption does not run off the canvas. */
  private fun wrap(text: String, paint: Paint, maxWidth: Float): List<String> {
    val words = text.split(" ").filter { it.isNotEmpty() }
    if (words.isEmpty()) {
      return emptyList()
    }
    val lines = mutableListOf<String>()
    var line = StringBuilder(words.first())
    for (word in words.drop(1)) {
      val candidate = line.toString() + " " + word
      if (paint.measureText(candidate) <= maxWidth) {
        line = StringBuilder(candidate)
      } else {
        lines.add(line.toString())
        line = StringBuilder(word)
      }
    }
    lines.add(line.toString())
    return lines
  }

  /** Where the file lives, for display in the settings screen. */
  @ReactMethod
  fun location(promise: Promise) {
    promise.resolve(storeFile().absolutePath)
  }

  /** Absolute path of shared storage, so JS can build note paths. */
  @ReactMethod
  fun externalRoot(promise: Promise) {
    promise.resolve(Environment.getExternalStorageDirectory().absolutePath)
  }

  /** Create a directory tree, so createNote does not fail on a missing parent. */
  @ReactMethod
  fun makeDirs(relativePath: String, promise: Promise) {
    try {
      val dir = File(Environment.getExternalStorageDirectory(), relativePath)
      promise.resolve(dir.isDirectory || dir.mkdirs())
    } catch (e: Exception) {
      promise.reject("MKDIR_FAILED", e.message ?: "Could not create directory", e)
    }
  }

  /**
   * Immediate subdirectory names of `relativePath`, sorted.
   *
   * One level only: the folder picker walks down a step at a time, so a deep
   * recursive listing would fetch far more than any single screen shows.
   */
  @ReactMethod
  fun listDirs(relativePath: String, promise: Promise) {
    try {
      val root = Environment.getExternalStorageDirectory()
      val dir = if (relativePath.isBlank()) root else File(root, relativePath)
      val out = Arguments.createArray()
      if (!dir.isDirectory) {
        promise.resolve(out)
        return
      }
      dir.listFiles()
          ?.filter { it.isDirectory && !it.isHidden }
          ?.sortedBy { it.name.lowercase() }
          ?.forEach { out.pushString(it.name) }
      promise.resolve(out)
    } catch (e: Exception) {
      promise.reject("LIST_DIRS_FAILED", e.message ?: "Could not list folders", e)
    }
  }

  /**
   * Every .note file under `relativeRoot`, as paths relative to shared storage.
   *
   * Returned as one list rather than exposing a per-day existence check: the
   * month grid asks about 42 days at once, and 42 native round trips per render
   * would be visibly slow on this hardware.
   */
  @ReactMethod
  fun listNotes(relativeRoot: String, promise: Promise) {
    try {
      val root = Environment.getExternalStorageDirectory()
      val start = File(root, relativeRoot)
      val out = Arguments.createArray()
      if (!start.isDirectory) {
        promise.resolve(out)
        return
      }

      val prefix = root.absolutePath.trimEnd('/') + "/"
      var seen = 0
      // Iterative walk with a hard cap: a user could point this at a huge tree,
      // and an unbounded recursive walk would block the bridge.
      val stack = ArrayDeque(listOf(start))
      while (stack.isNotEmpty() && seen < MAX_NOTES) {
        val dir = stack.removeLast()
        val children = dir.listFiles() ?: continue
        for (child in children) {
          if (seen >= MAX_NOTES) break
          if (child.isDirectory) {
            stack.addLast(child)
          } else if (child.name.endsWith(".note", ignoreCase = true)) {
            out.pushString(child.absolutePath.removePrefix(prefix))
            seen++
          }
        }
      }
      promise.resolve(out)
    } catch (e: Exception) {
      promise.reject("LIST_FAILED", e.message ?: "Could not list notes", e)
    }
  }

  companion object {
    const val NAME = "TaskHubSettingsStore"
    private const val STORE_DIR = "Document/TaskHub"
    private const val STORE_FILE = "settings.json"
    /** Upper bound on a directory walk, so a mis-set root cannot hang the bridge. */
    private const val MAX_NOTES = 2000
    /** Canvas width for the link image; the viewer scales it down to fit. */
    private const val CANVAS_WIDTH = 1400
  }
}
