import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:open_filex/open_filex.dart';
import 'package:share_plus/share_plus.dart';

import '../app_controller.dart';
import '../models/document.dart';
import '../services/document_analyzer.dart';
import '../services/document_store.dart';

/// One document: its pages, what was read from it, and where it is synced.
class DocumentScreen extends StatefulWidget {
  const DocumentScreen({
    super.key,
    required this.controller,
    required this.document,
  });

  final AppController controller;
  final DocumentRecord document;

  @override
  State<DocumentScreen> createState() => _DocumentScreenState();
}

class _DocumentScreenState extends State<DocumentScreen> {
  late DocumentRecord _doc = widget.document;
  List<SyncEntry> _syncEntries = const [];
  int _page = 0;

  AppController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    _c.sync.addListener(_loadSync);
    _loadSync();
  }

  @override
  void dispose() {
    _c.sync.removeListener(_loadSync);
    super.dispose();
  }

  Future<void> _loadSync() async {
    final entries = await _c.store.syncEntriesFor(_doc.id);
    if (mounted) setState(() => _syncEntries = entries);
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _openPdf() async {
    final result = await OpenFilex.open(
      _c.files.pdf(_doc).path,
      type: 'application/pdf',
    );
    if (result.type != ResultType.done && mounted) {
      _showError(
        result.type == ResultType.noAppToOpen
            ? 'No app installed that can open PDFs'
            : 'Could not open the PDF: ${result.message}',
      );
    }
  }

  Future<void> _share() => SharePlus.instance.share(
    ShareParams(
      files: [XFile(_c.files.pdf(_doc).path, mimeType: 'application/pdf')],
    ),
  );

  Future<void> _rename() async {
    final field = TextEditingController(text: _doc.title);
    final title = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Rename'),
        content: TextField(
          controller: field,
          autofocus: true,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(suffixText: '.pdf'),
          onSubmitted: (v) => Navigator.pop(context, v),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, field.text),
            child: const Text('Rename'),
          ),
        ],
      ),
    );
    if (title == null || title.trim().isEmpty) return;
    await _apply(() => _c.edit(_doc, title: title));
  }

  Future<void> _move() async {
    final category = await showModalBottomSheet<DocCategory>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final c in DocCategory.values)
              ListTile(
                leading: Icon(c.icon),
                title: Text(c.folder),
                trailing: c == _doc.category ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(context, c),
              ),
          ],
        ),
      ),
    );
    if (category == null || category == _doc.category) return;
    await _apply(() => _c.edit(_doc, category: category));
  }

  Future<void> _apply(Future<DocumentRecord> Function() change) async {
    try {
      final updated = await change();
      if (mounted) setState(() => _doc = updated);
    } catch (e) {
      if (mounted) _showError('Could not save the change: $e');
    }
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete this document?'),
        content: Text(
          _c.hasActiveTarget
              ? '“${_doc.title}” will be removed from this phone and from '
                    'the places it is synced to.'
              : '“${_doc.title}” will be removed from this phone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await _c.delete(_doc);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) _showError('Could not delete the document: $e');
    }
  }

  void _showText() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.95,
        builder: (context, scroll) => Column(
          children: [
            ListTile(
              title: const Text('Text in this document'),
              trailing: IconButton(
                tooltip: 'Copy all',
                icon: const Icon(Icons.copy),
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: _doc.ocrText));
                  Navigator.pop(context);
                  _showError('Text copied');
                },
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                controller: scroll,
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                child: SelectableText(
                  _doc.ocrText.isEmpty
                      ? 'No text was found in this document.'
                      : _doc.ocrText,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(_doc.title),
        actions: [
          IconButton(
            tooltip: 'Share',
            icon: const Icon(Icons.share_outlined),
            onPressed: _share,
          ),
          PopupMenuButton<VoidCallback>(
            onSelected: (action) => action(),
            itemBuilder: (context) => [
              PopupMenuItem(value: _rename, child: const Text('Rename')),
              PopupMenuItem(value: _move, child: const Text('Move to…')),
              PopupMenuItem(value: _delete, child: const Text('Delete')),
            ],
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          SizedBox(
            height: MediaQuery.sizeOf(context).height * 0.55,
            child: ColoredBox(
              color: theme.colorScheme.surfaceContainerHighest,
              child: PageView.builder(
                itemCount: _doc.pageCount,
                onPageChanged: (i) => setState(() => _page = i),
                itemBuilder: (context, i) => InteractiveViewer(
                  maxScale: 5,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Image.file(
                      _c.files.page(_doc, i),
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) =>
                          const Center(child: Icon(Icons.broken_image)),
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (_doc.pageCount > 1)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Page ${_page + 1} of ${_doc.pageCount}',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall,
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _openPdf,
                    icon: const Icon(Icons.picture_as_pdf_outlined),
                    label: const Text('Open PDF'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _showText,
                    icon: const Icon(Icons.notes),
                    label: const Text('View text'),
                  ),
                ),
              ],
            ),
          ),
          ListTile(
            leading: Icon(_doc.category.icon),
            title: Text(_doc.category.folder),
            subtitle: const Text('Folder'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _move,
          ),
          if (_doc.vendor != null) _detail('From', _doc.vendor!),
          if (_doc.docDate != null)
            _detail('Date on document', formatDate(_doc.docDate!)),
          if (_doc.amount != null)
            _detail('Total', '\$${_doc.amount!.toStringAsFixed(2)}'),
          _detail('Scanned', formatDate(_doc.createdAt)),
          for (final target in _c.sync.targets)
            if (_c.isTargetEnabled(target)) _syncTile(target.id, target.name),
        ],
      ),
    );
  }

  Widget _detail(String label, String value) =>
      ListTile(dense: true, title: Text(value), subtitle: Text(label));

  Widget _syncTile(String targetId, String targetName) {
    final entry = _syncEntries.where((e) => e.target == targetId).firstOrNull;
    final (icon, text) = switch (entry?.status) {
      SyncStatus.synced => (Icons.cloud_done_outlined, 'Synced'),
      SyncStatus.error => (
        Icons.error_outline,
        'Sync failed: ${entry?.error ?? 'unknown error'}',
      ),
      _ => (Icons.cloud_upload_outlined, 'Waiting to sync'),
    };
    return ListTile(
      dense: true,
      leading: Icon(icon),
      title: Text(text),
      subtitle: Text(targetName),
    );
  }
}
