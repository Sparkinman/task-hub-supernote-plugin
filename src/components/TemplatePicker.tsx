/* eslint-disable no-void -- void marks a deliberately un-awaited promise */
/**
 * Template chooser showing each template as a thumbnail.
 *
 * The previous version listed template names as text, which was unreadable —
 * the names are short and meaningless out of context ("A5X_line_1"), so a
 * picture is the only useful way to choose one. `vUri` points at the template
 * image, so it can be rendered directly.
 *
 * The sheet is split in two: the templates built into the device, and the ones
 * the user keeps in MyStyle. They are separate collections that happen to be
 * usable in the same place, and mixing them into one long grid made it
 * impossible to tell which was which or to find your own among fifty built-ins.
 *
 * Deliberately two components. `TemplatePicker` is the one row that sits in the
 * settings form; `TemplateSheet` is the grid, and it must be mounted at the app
 * root, OUTSIDE the settings ScrollView — see its own note for why.
 */

import React, {useEffect, useState} from 'react';
import {Image, Pressable, ScrollView, Text, View} from 'react-native';

import type {NoteTemplate} from '../notes';
import {externalRoot} from '../storage';
import {TemplateBrowser} from './TemplateBrowser';
import {Button, Field, Tabs, styles} from './common';

/** The label a chosen template shows, falling back to the file's own name. */
function chosenLabel(templates: NoteTemplate[], value: string): string {
  const chosen = templates.find(t => t.vUri === value);
  if (chosen) {
    return chosen.name;
  }
  return value ? value.slice(value.lastIndexOf('/') + 1) : 'Device default';
}

/**
 * The settings row that opens the chooser.
 *
 * It owns nothing but the summary line: opening is the caller's business,
 * because the sheet it opens is mounted somewhere else entirely.
 */
export function TemplatePicker(props: {
  templates: NoteTemplate[];
  /** Currently chosen vUri, or '' for the device default. */
  value: string;
  label: string;
  onOpen: () => void;
}): React.JSX.Element {
  const {templates, value, label, onOpen} = props;
  return (
    <Pressable style={styles.templateSummary} onPress={onOpen}>
      <Text style={styles.templateSummaryText}>
        {label}: {chosenLabel(templates, value)}
      </Text>
      <Text style={styles.templateSummaryHint}>Tap to change</Text>
    </Pressable>
  );
}

/**
 * The chooser itself, as a full-window sheet.
 *
 * Mount this at the app root, beside FolderPicker and MiniCalendar, and never
 * inside the settings ScrollView. `overlayScrim` is absolutely positioned, so
 * inside the scroll content it is positioned against the row that rendered it
 * rather than against the window: the grid drew on top of whatever settings
 * happened to be underneath, scrolled with the page, and — because Android does
 * not deliver touches to a child drawn outside its parent's bounds — most of
 * the tiles could be seen but not tapped. That is what this split is for.
 */
export function TemplateSheet(props: {
  visible: boolean;
  templates: NoteTemplate[];
  /** Currently chosen vUri, or '' for the device default. */
  value: string;
  label: string;
  onPick: (vUri: string) => void;
  onCancel: () => void;
}): React.JSX.Element | null {
  const {visible, templates, value, label, onPick, onCancel} = props;
  /**
   * Which collection is showing.
   *
   * Every opening starts on Built in, with no search. The tab used to be chosen
   * once, from wherever the current template happened to live — so after picking
   * a file through the browser, every subsequent opening began in the file
   * browser, several folders from anything useful. The templates you would
   * normally want are the built-in ones, so that is where the sheet opens; the
   * other two tabs are one tap away.
   */
  const [source, setSource] = useState<'system' | 'user' | 'browse'>('system');
  /** Filters the tiles by name, for a device with fifty built-in templates. */
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (visible) {
      setSource('system');
      setSearch('');
    }
  }, [visible]);
  /**
   * Absolute storage root, needed to turn a browsed file's relative path into a
   * URI the Image component can render. Read once when the sheet first opens
   * rather than on every render.
   */
  const [storageRoot, setStorageRoot] = useState('');
  useEffect(() => {
    if (visible && !storageRoot) {
      void externalRoot().then(root => setStorageRoot(root ?? ''));
    }
  }, [visible, storageRoot]);
  // A URI the host reports but cannot render should degrade to its name rather
  // than leaving an empty tile.
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  if (!visible) {
    return null;
  }

  const system = templates.filter(t => !t.userPath);
  const user = templates.filter(t => t.userPath);
  const needle = search.trim().toLowerCase();
  const showing = (source === 'user' ? user : system).filter(
    t => !needle || t.name.toLowerCase().includes(needle),
  );

  const grid = (
    <View style={styles.templateGrid}>
      <Pressable
        style={[styles.templateTile, value === '' && styles.templateTileOn]}
        onPress={() => onPick('')}>
        <View style={styles.templateBlank}>
          <Text style={styles.templateBlankText}>Default</Text>
        </View>
        <Text style={styles.templateName} numberOfLines={1}>
          Device default
        </Text>
      </Pressable>

      {showing.length === 0 && (
        <Text style={styles.noteCompact}>
          {needle
            ? `Nothing here matches "${search.trim()}".`
            : source === 'user'
              ? 'No templates found in MyStyle. Copy a PNG, JPG or JPEG into that folder on the device and reopen this.'
              : 'The device reported no built-in templates.'}
        </Text>
      )}

      {showing.map(t => {
        const selected = t.vUri === value;
        return (
          <Pressable
            key={t.vUri}
            style={[styles.templateTile, selected && styles.templateTileOn]}
            onPress={() => onPick(t.vUri)}>
            {broken[t.vUri] ? (
              <View style={styles.templateBlank}>
                <Text style={styles.templateBlankText}>?</Text>
              </View>
            ) : (
              <Image
                source={{uri: t.vUri}}
                style={styles.templateThumb}
                resizeMode="contain"
                onError={() => setBroken(prev => ({...prev, [t.vUri]: true}))}
              />
            )}
            <Text style={styles.templateName} numberOfLines={1}>
              {t.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={styles.overlayScrim}>
      <View style={styles.pickerCard}>
        <Text style={styles.modalTitle}>{label}</Text>
        <Text style={styles.pickerPath}>Current: {chosenLabel(templates, value)}</Text>
        <Tabs
          tabs={[
            {key: 'system', label: `Built in (${system.length})`},
            {key: 'user', label: `My Style (${user.length})`},
            {key: 'browse', label: 'File Browser'},
          ]}
          value={source}
          onPick={k => setSource(k as 'system' | 'user' | 'browse')}
        />
        <Text style={styles.noteCompact}>
          Built in: the device's own page styles. My Style: templates you have put in the
          MyStyle folder. File Browser: any PNG, JPG or JPEG anywhere on the device — those
          are the only formats the device accepts as a template.
        </Text>
        {source !== 'browse' && (
          <Field
            label="Search templates"
            value={search}
            placeholder="Type part of a name"
            onChange={setSearch}
            compact
          />
        )}
        <ScrollView style={styles.templateScroll}>
          {source === 'browse' ? (
            <TemplateBrowser storageRoot={storageRoot} value={value} onPick={onPick} />
          ) : (
            grid
          )}
        </ScrollView>
        {/*
          Two ways out, one at each end, because the sheet fills the screen
          and the file browser can be several folders deep: Exit on the left
          leaves it, Done on the right confirms and leaves. Both close it —
          the choice is already made by tapping a template — but a sheet
          with only one corner to escape from reads as a trap.
        */}
        <View style={styles.sheetActions}>
          <Button label="Exit" onPress={onCancel} />
          <Button label="Done" primary onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}
