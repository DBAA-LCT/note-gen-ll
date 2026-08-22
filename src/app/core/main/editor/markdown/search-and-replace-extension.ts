import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

interface SearchAndReplaceStorage {
  searchTerm: string
  replaceTerm: string
  results: Array<{ from: number; to: number }>
  resultIndex: number
  caseSensitive: boolean
  lastSearchTerm: string
  lastCaseSensitive: boolean
  lastResultIndex: number
}

const searchAndReplacePluginKey = new PluginKey<DecorationSet>('searchAndReplace')

function findMatches(
  doc: ProseMirrorNode,
  term: string,
  caseSensitive: boolean,
): Array<{ from: number; to: number }> {
  if (!term) return []
  const needle = caseSensitive ? term : term.toLocaleLowerCase()
  const results: Array<{ from: number; to: number }> = []

  doc.descendants((node, position) => {
    if (!node.isTextblock) return

    const runs: Array<{ from: number; text: string }> = []
    node.descendants((child, childPosition) => {
      if (!child.isText || !child.text) return

      const from = position + 1 + childPosition
      const previous = runs.at(-1)
      if (previous && previous.from + previous.text.length === from) {
        previous.text += child.text
      } else {
        runs.push({ from, text: child.text })
      }
    })

    for (const run of runs) {
      const haystack = caseSensitive ? run.text : run.text.toLocaleLowerCase()
      let index = 0
      while ((index = haystack.indexOf(needle, index)) >= 0) {
        results.push({ from: run.from + index, to: run.from + index + term.length })
        index += Math.max(1, term.length)
      }
    }
  })

  return results
}

export const SearchAndReplace = Extension.create<Record<string, never>, SearchAndReplaceStorage>({
  name: 'searchAndReplace',

  addStorage() {
    return {
      searchTerm: '',
      replaceTerm: '',
      results: [],
      resultIndex: 0,
      caseSensitive: false,
      lastSearchTerm: '',
      lastCaseSensitive: false,
      lastResultIndex: 0,
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin<DecorationSet>({
      key: searchAndReplacePluginKey,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, previous) {
          const storage = (editor.storage as unknown as {
            searchAndReplace: SearchAndReplaceStorage
          }).searchAndReplace
          if (
            !transaction.docChanged
            && storage.searchTerm === storage.lastSearchTerm
            && storage.caseSensitive === storage.lastCaseSensitive
            && storage.resultIndex === storage.lastResultIndex
          ) return previous

          storage.lastSearchTerm = storage.searchTerm
          storage.lastCaseSensitive = storage.caseSensitive
          storage.lastResultIndex = storage.resultIndex
          storage.results = findMatches(transaction.doc, storage.searchTerm, storage.caseSensitive)
          if (storage.resultIndex >= storage.results.length) storage.resultIndex = 0

          const decorations = storage.results.map((result, index) => Decoration.inline(
            result.from,
            result.to,
            { class: index === storage.resultIndex ? 'search-result search-result-current' : 'search-result' },
          ))
          return decorations.length > 0
            ? DecorationSet.create(transaction.doc, decorations)
            : DecorationSet.empty
        },
      },
      props: {
        decorations(state) {
          return searchAndReplacePluginKey.getState(state) ?? DecorationSet.empty
        },
      },
    })]
  },
})