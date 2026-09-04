/* eslint-disable no-void -- void marks deliberately un-awaited promises in handlers */
/**
 * Modal folder browser over the device's shared storage.
 *
 * Walks one level at a time rather than showing a tree: the panel is small, a
 * device holds thousands of folders, and a step-wise walk needs only one native
 * call per screen.
 */

import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Modal, Pressable, ScrollView, Text, View} from 'react-native';

import {listDirs} from '../storage';
import {Button, styles} from './common';

export function FolderPicker(props: {
  visible: boolean;
  /** Folder the picker opens on, relative to shared storage. */
  initialPath: string;
  onCancel: () => void;
  onPick: (relativePath: string) => void;
}): React.JSX.Element {
  const {visible, initialPath, onCancel, onPick} = props;
  const [path, setPath] = useState(initialPath);
  const [dirs, setDirs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (next: string) => {
    setBusy(true);
    try {
      setDirs(await listDirs(next));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setPath(initialPath);
      void load(initialPath);
    }
  }, [visible, initialPath, load]);

  const goTo = (next: string) => {
    setPath(next);
    void load(next);
  };

  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.pickerCard}>
          <Text style={styles.modalTitle}>Choose a folder</Text>
          <Text style={styles.pickerPath}>{path ? `/${path}` : '/ (storage root)'}</Text>

          <View style={styles.pickerNav}>
            <Button label="⌂ Root" onPress={() => goTo('')} />
            {!!path && <Button label="↑ Up" onPress={() => goTo(parent)} />}
          </View>

          <ScrollView style={styles.pickerList}>
            {busy && <ActivityIndicator color="#000" />}
            {!busy && dirs.length === 0 && (
              <Text style={styles.weekEmpty}>No subfolders here.</Text>
            )}
            {dirs.map(name => (
              <Pressable
                key={name}
                style={styles.pickerRow}
                onPress={() => goTo(path ? `${path}/${name}` : name)}>
                <Text style={styles.pickerRowText}>▸ {name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.modalActions}>
            <Button label="Use this folder" primary onPress={() => onPick(path)} />
            <Button label="Cancel" onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
