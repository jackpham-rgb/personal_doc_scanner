import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../app_controller.dart';
import '../models/document.dart';
import '../services/document_analyzer.dart';
import 'document_screen.dart';
import 'settings_screen.dart';

/// The library: a search box over everything that has been scanned, and the
/// button that starts a scan.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _search = TextEditingController();

  AppController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    if (_c.settings.scanOnLaunch) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _scan());
    }
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final doc = await _c.scan();
      if (doc == null || !mounted) return;
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text('Saved “${doc.title}” in ${doc.category.folder}'),
            action: SnackBarAction(label: 'View', onPressed: () => _open(doc)),
          ),
        );
    } on PlatformException catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text('Scanning failed: ${e.message ?? e.code}')),
      );
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text('Could not process the scan: $e')),
      );
    }
  }

  void _open(DocumentRecord doc) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => DocumentScreen(controller: _c, document: doc),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([_c, _c.sync]),
      builder: (context, _) {
        final docs = _c.documents;
        final searching = _c.query.trim().isNotEmpty || _c.category != null;
        return Scaffold(
          appBar: AppBar(
            title: const Text('Documents'),
            actions: [
              if (_c.sync.isSyncing)
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 12),
                  child: Center(
                    child: SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  ),
                ),
              IconButton(
                tooltip: 'Settings',
                icon: const Icon(Icons.settings_outlined),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => SettingsScreen(controller: _c),
                  ),
                ),
              ),
            ],
          ),
          body: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                child: SearchBar(
                  controller: _search,
                  hintText: 'Search inside your documents',
                  elevation: const WidgetStatePropertyAll(0),
                  leading: const Icon(Icons.search),
                  trailing: [
                    if (_search.text.isNotEmpty)
                      IconButton(
                        tooltip: 'Clear',
                        icon: const Icon(Icons.close),
                        onPressed: () {
                          _search.clear();
                          _c.setQuery('');
                        },
                      ),
                  ],
                  onChanged: _c.setQuery,
                ),
              ),
              if (_c.categoryCounts.length > 1) _categoryChips(),
              if (_c.processing != null) _processingBanner(_c.processing!),
              Expanded(
                child: docs.isEmpty
                    ? _EmptyState(searching: searching)
                    : ListView.builder(
                        padding: const EdgeInsets.only(bottom: 96),
                        itemCount: docs.length,
                        itemBuilder: (context, i) => _tile(docs[i]),
                      ),
              ),
            ],
          ),
          floatingActionButton: FloatingActionButton.extended(
            onPressed: _c.processing == null ? _scan : null,
            icon: const Icon(Icons.document_scanner_outlined),
            label: const Text('Scan'),
          ),
        );
      },
    );
  }

  Widget _categoryChips() {
    final present = DocCategory.values
        .where((c) => (_c.categoryCounts[c] ?? 0) > 0)
        .toList();
    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: FilterChip(
              label: const Text('All'),
              selected: _c.category == null,
              onSelected: (_) => _c.setCategory(null),
            ),
          ),
          for (final c in present)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: FilterChip(
                label: Text('${c.folder} ${_c.categoryCounts[c]}'),
                selected: _c.category == c,
                onSelected: (on) => _c.setCategory(on ? c : null),
              ),
            ),
        ],
      ),
    );
  }

  Widget _processingBanner(ProcessingStatus status) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      decoration: BoxDecoration(
        color: scheme.secondaryContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(
              status.message,
              style: TextStyle(color: scheme.onSecondaryContainer),
            ),
          ),
          const LinearProgressIndicator(minHeight: 3),
        ],
      ),
    );
  }

  Widget _tile(DocumentRecord doc) {
    final theme = Theme.of(context);
    final details = [
      doc.category.folder,
      formatDate(doc.docDate ?? doc.createdAt),
      if (doc.amount != null) '\$${doc.amount!.toStringAsFixed(2)}',
    ].join(' · ');
    final snippet = doc.snippet?.replaceAll(RegExp(r'\s+'), ' ').trim();

    return ListTile(
      leading: ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: SizedBox(
          width: 44,
          height: 56,
          child: Image.file(
            _c.files.page(doc, 0),
            fit: BoxFit.cover,
            cacheWidth: 132,
            errorBuilder: (_, _, _) => ColoredBox(
              color: theme.colorScheme.surfaceContainerHighest,
              child: Icon(doc.category.icon, size: 20),
            ),
          ),
        ),
      ),
      title: Text(doc.title, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        snippet == null || snippet.isEmpty ? details : '$details\n$snippet',
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      isThreeLine: snippet != null && snippet.isNotEmpty,
      trailing: !_c.hasActiveTarget
          ? null
          : Icon(
              _c.syncedIds.contains(doc.id)
                  ? Icons.cloud_done_outlined
                  : Icons.cloud_upload_outlined,
              size: 20,
              color: theme.colorScheme.outline,
              semanticLabel: _c.syncedIds.contains(doc.id)
                  ? 'Synced'
                  : 'Waiting to sync',
            ),
      onTap: () => _open(doc),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.searching});

  final bool searching;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              searching ? Icons.search_off : Icons.document_scanner_outlined,
              size: 56,
              color: theme.colorScheme.outline,
            ),
            const SizedBox(height: 16),
            Text(
              searching ? 'No documents match' : 'No documents yet',
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              searching
                  ? 'Try a different word, a company name or a month.'
                  : 'Tap Scan and point the camera at a document. It is '
                        'cropped, read, named and filed for you.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
