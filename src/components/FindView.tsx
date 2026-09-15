/**
 * Find: the keywords and starred pages across the notes this plugin files.
 *
 * One scroll rather than a switch between two modes — starred pages first,
 * keywords underneath, and the filter above both. The point is that it is
 * useful before anything is typed: a Supernote keyboard is slow enough that a
 * view which only answers once you have typed into it is a view nobody opens
 * twice. Typing narrows what is already on screen.
 *
 * A starred page has no text of its own, so the filter matches its note's name
 * and period. A keyword has text and is matched on it directly. Both are read
 * straight out of the file by the device — nothing here is recognition, and
 * nothing here is a guess.
 */

import React, {useState} from 'react';
import {Pressable, Text, View} from 'react-native';

import type {KeywordHit, StarHit} from '../notesearch';
import {Button, Field, LoadingLine, Section, styles} from './common';

/** What a completed scan reports about itself, for a legible empty state. */
export interface FindSummary {
  found: number;
  failed: number;
  walked: string[];
}

/** `Daily · p.3`, or just the page when the root serves several periods. */
function pageLabel(label: string, page: number): string {
  const human = `p.${page + 1}`;
  return label ? `${label} · ${human}` : human;
}

function HitRow(props: {
  name: string;
  detail: string;
  indented?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={[styles.findRow, props.indented && styles.findRowIndented]}
      onPress={props.onPress}>
      <Text style={styles.findRowName} numberOfLines={1}>
        {props.name}
      </Text>
      <Text style={styles.findRowMeta}>{props.detail}</Text>
    </Pressable>
  );
}

export function FindView(props: {
  query: string;
  onQuery: (value: string) => void;
  stars: StarHit[];
  keywords: KeywordHit[];
  starredPages: number;
  scanning: boolean;
  progress: {done: number; total: number} | null;
  summary: FindSummary | null;
  onOpen: (path: string, page: number) => void;
  onRescan: () => void;
  scrollHandle?: number | null;
  onScrollTo?: (y: number) => void;
}): React.JSX.Element {
  const [starsOpen, setStarsOpen] = useState(true);
  const [keywordsOpen, setKeywordsOpen] = useState(true);
  // Which keyword's pages are showing. Collapsed by default so the list stays
  // scannable: the count on each row already says how much is behind it.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const {summary, scanning, progress} = props;
  const nothingIndexed = !scanning && summary !== null && summary.found === 0;
  const nothingMarked =
    !scanning &&
    summary !== null &&
    summary.found > 0 &&
    props.stars.length === 0 &&
    props.keywords.length === 0 &&
    props.query.trim() === '';

  return (
    <>
      <View style={styles.actions}>
        <Button label="Rescan" onPress={props.onRescan} disabled={scanning} />
      </View>

      <Field
        scrollHandle={props.scrollHandle}
        onScrollTo={props.onScrollTo}
        label="Search"
        value={props.query}
        placeholder="Filter keywords and notes"
        onChange={props.onQuery}
      />

      <LoadingLine
        visible={scanning}
        // Counted rather than vague: a scan is proportional to how many notes
        // changed, so "Reading notes…" alone gives no sense of whether this is
        // two seconds or twenty.
        label={
          progress && progress.total > 0
            ? `Reading notes… ${progress.done} of ${progress.total}`
            : 'Reading notes…'
        }
      />

      {/*
        A file that refused to be read is said out loud rather than quietly
        omitted. A note missing from the results is otherwise indistinguishable
        from a note with nothing in it.
      */}
      {!scanning && !!summary?.failed && (
        <Text style={styles.note}>
          {summary.failed} {summary.failed === 1 ? 'note' : 'notes'} could not be read and{' '}
          {summary.failed === 1 ? 'is' : 'are'} not listed here. They may be encrypted or
          open elsewhere.
        </Text>
      )}

      {nothingIndexed && (
        <Text style={styles.empty}>
          No notes found.{'\n'}
          {summary.walked.length > 0
            ? `Looked in ${summary.walked.join(', ')}.`
            : 'No note folders are switched on in Settings → Notes.'}
        </Text>
      )}

      {nothingMarked && (
        <Text style={styles.empty}>
          Found {summary.found} {summary.found === 1 ? 'note' : 'notes'}, none with a keyword
          or a star.{'\n'}
          Add a keyword to a page, or star one, and it will show up here.
        </Text>
      )}

      {!nothingIndexed && !nothingMarked && (
        <>
          <Section
            title="Starred pages"
            count={props.starredPages}
            open={starsOpen}
            onToggle={() => setStarsOpen(v => !v)}>
            {props.stars.length === 0 ? (
              <Text style={styles.note}>Nothing starred matches that.</Text>
            ) : (
              props.stars.map(hit =>
                hit.pages.map(page => (
                  <HitRow
                    key={`${hit.path}:${page}`}
                    name={hit.name}
                    detail={pageLabel(hit.label, page)}
                    onPress={() => props.onOpen(hit.path, page)}
                  />
                )),
              )
            )}
          </Section>

          <Section
            title="Keywords"
            count={props.keywords.length}
            open={keywordsOpen}
            onToggle={() => setKeywordsOpen(v => !v)}>
            {props.keywords.length === 0 ? (
              <Text style={styles.note}>No keyword matches that.</Text>
            ) : (
              props.keywords.map(hit => {
                const key = hit.keyword.toLowerCase();
                const open = expanded[key] === true;
                return (
                  <View key={key}>
                    <Pressable
                      style={styles.findRow}
                      onPress={() => setExpanded(prev => ({...prev, [key]: !open}))}>
                      <Text style={styles.findRowName} numberOfLines={1}>
                        {open ? '▾' : '▸'} {hit.keyword}
                      </Text>
                      <Text style={styles.findRowMeta}>{hit.pages.length}</Text>
                    </Pressable>
                    {open &&
                      hit.pages.map(page => (
                        <HitRow
                          key={`${page.path}:${page.page}`}
                          name={page.name}
                          detail={pageLabel(page.label, page.page)}
                          indented
                          onPress={() => props.onOpen(page.path, page.page)}
                        />
                      ))}
                  </View>
                );
              })
            )}
          </Section>
        </>
      )}
    </>
  );
}
