import 'package:shared_preferences/shared_preferences.dart';

/// User preferences, persisted on the device.
class AppSettings {
  AppSettings(this._prefs);

  final SharedPreferences _prefs;

  static Future<AppSettings> load() async =>
      AppSettings(await SharedPreferences.getInstance());

  /// Go straight to the camera when the app is opened.
  bool get scanOnLaunch => _prefs.getBool('scan_on_launch') ?? false;
  set scanOnLaunch(bool v) => _prefs.setBool('scan_on_launch', v);

  /// Whether a sync destination is switched on. The phone folder needs no
  /// setup, so it is on until the user turns it off; anything that needs an
  /// account starts off.
  bool targetEnabled(String id, {bool fallback = false}) =>
      _prefs.getBool('sync.$id.enabled') ?? fallback;
  Future<void> setTargetEnabled(String id, bool v) =>
      _prefs.setBool('sync.$id.enabled', v);

  String? getString(String key) => _prefs.getString(key);
  Future<void> setString(String key, String value) =>
      _prefs.setString(key, value);

  Future<void> removeWithPrefix(String prefix) async {
    for (final key in _prefs.getKeys().where((k) => k.startsWith(prefix))) {
      await _prefs.remove(key);
    }
  }
}
