export interface Params {
  [key: string]: string
}

export interface MatchResult<T> {
  data: T
  params: Params
}

interface TrieNode<T> {
  /** Literal segment children */
  staticChildren: Map<string, TrieNode<T>>
  /** Required param child: :name */
  paramChild: { name: string; node: TrieNode<T> } | null
  /** Optional param child: :name? */
  optParamChild: { name: string; node: TrieNode<T> } | null
  /** Wildcard (*) data — captures the rest of the path */
  wildcardData: T | null
  /** Handler data registered at this exact node */
  data: T | null
}

function makeNode<T>(): TrieNode<T> {
  return {
    staticChildren: new Map(),
    paramChild: null,
    optParamChild: null,
    wildcardData: null,
    data: null,
  }
}

/**
 * Radix-style trie for path-based routing.
 *
 * Segment priority (highest → lowest):
 *   static  >  :param  >  :param?  >  *
 */
export class Trie<T> {
  readonly root: TrieNode<T> = makeNode()

  insert(path: string, data: T): void {
    const segs = splitPath(path)
    let node = this.root

    for (const [i, seg] of segs.entries()) {
      if (seg === '*') {
        if (i !== segs.length - 1) {
          throw new Error(`Wildcard '*' must be the last segment in path: "${path}"`)
        }
        node.wildcardData = data
        return
      }

      if (seg.startsWith(':')) {
        const isOptional = seg.endsWith('?')
        const name = isOptional ? seg.slice(1, -1) : seg.slice(1)

        if (name.length === 0) {
          throw new Error(`Empty param name in path: "${path}"`)
        }

        if (isOptional) {
          if (!node.optParamChild) {
            node.optParamChild = { name, node: makeNode() }
          }
          node = node.optParamChild.node
        } else {
          if (!node.paramChild) {
            node.paramChild = { name, node: makeNode() }
          }
          node = node.paramChild.node
        }
      } else {
        let child = node.staticChildren.get(seg)
        if (!child) {
          child = makeNode()
          node.staticChildren.set(seg, child)
        }
        node = child
      }
    }

    node.data = data
  }

  find(path: string): MatchResult<T> | null {
    const segs = splitPath(path)
    return this.match(this.root, segs, 0, {})
  }

  private match(
    node: TrieNode<T>,
    segs: string[],
    idx: number,
    params: Params,
  ): MatchResult<T> | null {
    // All segments consumed — check for exact match at this node
    if (idx === segs.length) {
      if (node.data !== null) {
        return { data: node.data, params }
      }
      // Optional param can be absent at end of path
      if (node.optParamChild) {
        const { name, node: child } = node.optParamChild
        if (child.data !== null) {
          return { data: child.data, params: { ...params, [name]: '' } }
        }
      }
      return null
    }

    const seg = segs[idx]
    // idx < segs.length was checked above, so this is always defined
    if (seg === undefined) return null

    // 1. Static (highest priority)
    const staticChild = node.staticChildren.get(seg)
    if (staticChild) {
      const r = this.match(staticChild, segs, idx + 1, params)
      if (r) return r
    }

    // 2. Required param
    if (node.paramChild) {
      const { name, node: child } = node.paramChild
      const r = this.match(child, segs, idx + 1, { ...params, [name]: seg })
      if (r) return r
    }

    // 3. Optional param: try consuming, then try skipping
    if (node.optParamChild) {
      const { name, node: child } = node.optParamChild
      const rConsume = this.match(child, segs, idx + 1, { ...params, [name]: seg })
      if (rConsume) return rConsume
      const rSkip = this.match(child, segs, idx, { ...params, [name]: '' })
      if (rSkip) return rSkip
    }

    // 4. Wildcard (lowest priority) — captures the rest
    if (node.wildcardData !== null) {
      const rest = segs.slice(idx).join('/')
      return { data: node.wildcardData, params: { ...params, '*': rest } }
    }

    return null
  }
}

function splitPath(path: string): string[] {
  // Remove trailing slash (except for root "/")
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  return normalized.split('/').filter(Boolean)
}
