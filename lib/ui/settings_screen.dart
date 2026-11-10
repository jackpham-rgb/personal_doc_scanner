import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../services/sync/google_drive_target.dart';
import '../services/sync/local_folder_target.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _connecting = false;

  AppController get _c => widget.controller;

  Future<void> _connectDrive() async {
    setState(() => _connecting = true);
    try {
      await _c.connectDrive();
    } catch (e) {
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Could not connect to Google Drive'),
          content: SingleChildScrollView(
            child: Text(
              'Google Drive needs a one-time setup for this app (an OAuth '
              'client for its package name and signing key). The steps are '
              'in the README under “Google Drive setup”.\n\nDetails: $e',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('OK'),
            ),
          ],
        ),
      );
    } finally {
      if (mounted) setState(() => _connecting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Widget header(String text) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
      child: Text(
        text,
        style: theme.textTheme.labelLarge?.copyWith(
          color: theme.colorScheme.primary,
        ),
      ),
    );

    return ListenableBuilder(
      listenable: Listenable.merge([_c, _c.sync]),
      builder: (context, _) {
        final driveError = _c.sync.lastErrors[_c.googleDrive.id];
        final folderError = _c.sync.lastErrors[_c.localFolder.id];
        return Scaffold(
          appBar: AppBar(title: const Text('Settings')),
          body: ListView(
            children: [
              header('Scanning'),
              SwitchListTile(
                title: const Text('Open the camera when the app starts'),
                subtitle: const Text('Skip the library and scan straight away'),
                value: _c.settings.scanOnLaunch,
                onChanged: (v) => setState(() => _c.settings.scanOnLaunch = v),
              ),
              header('Sync'),
              SwitchListTile(
                title: const Text('Save to phone folder'),
                subtitle: Text(
                  !_c.localFolderSupported
                      ? 'Needs Android 10 or newer'
                      : folderError ??
                            '${LocalFolderTarget.rootFolder} — visible in the '
                                'Files app and to folder-sync apps',
                ),
                value:
                    _c.localFolderSupported &&
                    _c.isTargetEnabled(_c.localFolder),
                onChanged: _c.localFolderSupported
                    ? (v) => _c.setTargetEnabled(_c.localFolder, v)
                    : null,
              ),
              ListTile(
                title: const Text('Google Drive'),
                subtitle: Text(
                  _c.driveConnected
                      ? driveError ??
                            'Uploading to the “${GoogleDriveTarget.rootFolder}” '
                                'folder in your Drive'
                      : 'Not connected',
                ),
                trailing: _connecting
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : _c.driveConnected
                    ? TextButton(
                        onPressed: _c.disconnectDrive,
                        child: const Text('Disconnect'),
                      )
                    : FilledButton.tonal(
                        onPressed: _connectDrive,
                        child: const Text('Connect'),
                      ),
              ),
              ListTile(
                title: const Text('Sync now'),
                subtitle: Text(
                  _c.sync.isSyncing
                      ? 'Syncing…'
                      : _c.hasActiveTarget
                      ? 'Runs automatically after every scan'
                      : 'Turn on a destination above first',
                ),
                trailing: const Icon(Icons.sync),
                enabled: _c.hasActiveTarget && !_c.sync.isSyncing,
                onTap: _c.sync.sync,
              ),
            ],
          ),
        );
      },
    );
  }
}
