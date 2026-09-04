/**
 * Task Hub branding.
 *
 * The bundled PNGs are pre-darkened copies of the brand artwork. The source
 * logo's mid-blue (#3B82F6) sits at roughly 48% luminance, which a monochrome
 * e-ink panel renders as washed-out grey; luminance is scaled to ~55% at build
 * time so the strokes stay legible. Colour is not lost — the panel never had it.
 */

import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';

import {DEMO} from '../mode';

/**
 * The product name, everywhere it is shown.
 *
 * The demo says so in its own name rather than only in the banner: both plugins
 * can be installed at once, and someone looking at a screenshot — or at the
 * device a week later — should not have to work out which one they are in.
 */
export const APP_NAME = DEMO ? 'Task Hub Demo' : 'Task Hub';

/** Mark only — used in the top-left of every screen header. */
export function Logo(props: {size?: number}): React.JSX.Element {
  const size = props.size ?? 30;
  return (
    <Image
      source={require('../../assets/logo-mark.png')}
      style={{width: size, height: size}}
      resizeMode="contain"
      accessibilityLabel={APP_NAME}
    />
  );
}

/** Mark plus wordmark — the settings screen masthead. */
export function FullLogo(props: {width?: number}): React.JSX.Element {
  const width = props.width ?? 190;
  // Source is 520x382, so preserve that ratio rather than guessing a height.
  return (
    <Image
      source={require('../../assets/logo-full.png')}
      style={{width, height: Math.round((width * 382) / 520)}}
      resizeMode="contain"
      accessibilityLabel={APP_NAME}
    />
  );
}

export function Brand(props: {subtitle?: string}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Logo />
      <View>
        <Text style={styles.name}>{APP_NAME}</Text>
        {!!props.subtitle && <Text style={styles.subtitle}>{props.subtitle}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: 10},
  name: {fontSize: 28, fontWeight: '700', color: '#000'},
  subtitle: {fontSize: 20, color: '#555', marginTop: 1},
});
