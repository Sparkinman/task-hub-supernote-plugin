/* eslint-disable no-void -- void marks deliberately un-awaited promises in handlers */
/**
 * Browse the device's storage and pick any image as a note template.
 *
 * The other two tabs of the template sheet show fixed collections — what the
 * device ships with, and what is in MyStyle. This one exists because a template
 * can be anywhere: downloaded into Document, synced into a folder of its own, or
 * kept beside the notes it belongs to. Without it, using such a file means
 * moving it into MyStyle first.
 *
 * Walks one directory at a time, like FolderPicker, and for the same reasons: a
 * device holds thousands of folders, the panel is small, and a step-wise walk
 * costs one native call per screen instead of a recursive crawl.
 */

import React, {useCallback, useEffect, useState} from 'react';
import {Image, Pressable, Text, View} from 'react-native';

import {listDirs, listFilesHere} from '../storage';
import {Busy, styles} from './common';

/**
 * The image formats Ratta's SDK accepts, and nothing else.
 *
 * `createNote` takes "a custom template image path", and the SDK states in two
 * places — `insertImage` and the `Picture` type — that only png, jpg and jpeg
 * are supported. PDF was offered here at first and should not have been: the
 * device would have refused it, and the note would have been created with the
 * host default instead, silently.
 */
const TEMPLATE_SUFFIXES = ['.png', '.jpg', '.jpeg'];

export function TemplateBrowser(props: {
  /** Absolute root of shared storage, for building the preview URI. */
  storageRoot: string;
  /** Currently chosen template URI, so the picked file can be shown as chosen. */
  value: string;
  onPick: (uri: string, path: string) => void;
}): React.JSX.Element {
  const {storageRoot, value, onPick} = props;
  const [path, setPath] = useState('');
  const [dirs, setDirs] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  const load = useCallback(async (next: string) => {
    setBusy(true);
    try {
      // Both listings together: they are independent native calls and doing
      // them in series doubles the wait on every step into a folder.
      const [nextDirs, nextFiles] = await Promise.all([
        listDirs(next),
        listFilesHere(next, TEMPLATE_SUFFIXES),
      ]);
      setDirs(nextDirs);
      setFiles(nextFiles);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const goTo = (next: string) => {
    setPath(next);
    void load(next);
  };

  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

  return (
    <View>
      <Text style={styles.noteCompact}>
        {path ? `Device storage / ${path}` : 'Device storage'}
      </Text>

      <View style={styles.browserRow}>
        {!!path && (
          <Pressable style={styles.browserUp} onPress={() => goTo(parent)}>
            <Text style={styles.browserUpText}>↑ Up one folder</Text>
          </Pressable>
        )}
        {busy && <Busy />}
      </View>

      {dirs.map(name => {
        const next = path ? `${path}/${name}` : name;
        return (
          <Pressable key={next} style={styles.browserFolder} onPress={() => goTo(next)}>
            <Text style={styles.browserFolderText}>{name} ›</Text>
          </Pressable>
        );
      })}

      {files.length === 0 && !busy && (
        <Text style={styles.noteCompact}>
          No usable template images in this folder. The device accepts PNG, JPG and JPEG only —
          open a folder above to look elsewhere.
        </Text>
      )}

      <View style={styles.templateGrid}>
        {files.map(name => {
          const relative = path ? `${path}/${name}` : name;
          const uri = `file://${storageRoot}/${relative}`;
          const selected = uri === value;
          return (
            <Pressable
              key={relative}
              style={[styles.templateTile, selected && styles.templateTileOn]}
              onPress={() => onPick(uri, relative)}>
              {broken[uri] ? (
                <View style={styles.templateBlank}>
                  <Text style={styles.templateBlankText}>?</Text>
                </View>
              ) : (
                <Image
                  source={{uri}}
                  style={styles.templateThumb}
                  resizeMode="contain"
                  onError={() => setBroken(prev => ({...prev, [uri]: true}))}
                />
              )}
              <Text style={styles.templateName} numberOfLines={1}>
                {name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
