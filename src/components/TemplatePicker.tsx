/**
 * Template chooser showing each template as a thumbnail.
 *
 * The previous version listed template names as text, which was unreadable —
 * the names are short and meaningless out of context ("A5X_line_1"), so a
 * picture is the only useful way to choose one. `vUri` points at the template
 * image, so it can be rendered directly.
 */

import React, {useState} from 'react';
import {Image, Modal, Pressable, ScrollView, Text, View} from 'react-native';

import type {NoteTemplate} from '../notes';
import {Button, styles} from './common';

/**
 * Template chooser as a modal.
 *
 * The grid was previously inline, which pushed the rest of settings off screen.
 * As a sheet it can scroll independently and costs one row when closed.
 */
export function TemplatePicker(props: {
  templates: NoteTemplate[];
  /** Currently chosen vUri, or '' for the device default. */
  value: string;
  label: string;
  onPick: (vUri: string) => void;
}): React.JSX.Element {
  const {templates, value, label, onPick} = props;
  const [open, setOpen] = useState(false);
  // A URI the host reports but cannot render should degrade to its name rather
  // than leaving an empty tile.
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  if (templates.length === 0) {
    return (
      <Text style={styles.noteCompact}>
        No built-in templates reported by the device — new notes use the host default.
      </Text>
    );
  }

  const chosen = templates.find(t => t.vUri === value);

  const grid = (
    <View style={styles.templateGrid}>
      <Pressable
        style={[styles.templateTile, value === '' && styles.templateTileOn]}
        onPress={() => {
          onPick('');
          setOpen(false);
        }}>
        <View style={styles.templateBlank}>
          <Text style={styles.templateBlankText}>Default</Text>
        </View>
        <Text style={styles.templateName} numberOfLines={1}>
          Device default
        </Text>
      </Pressable>

      {templates.map(t => {
        const selected = t.vUri === value;
        return (
          <Pressable
            key={t.vUri}
            style={[styles.templateTile, selected && styles.templateTileOn]}
            onPress={() => {
              onPick(t.vUri);
              setOpen(false);
            }}>
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
    <>
      <Pressable style={styles.templateSummary} onPress={() => setOpen(true)}>
        <Text style={styles.templateSummaryText}>
          {label}: {chosen ? chosen.name : 'Device default'}
        </Text>
        <Text style={styles.templateSummaryHint}>Tap to change</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.pickerCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            <ScrollView style={styles.templateScroll}>{grid}</ScrollView>
            <View style={styles.modalActions}>
              <Button label="Done" primary onPress={() => setOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
