//! Browser engine. Offsets use UTF-16 so bookmarks, highlights and DOM ranges
//! agree with the original reader, including for unmatched surrogate units.
use std::cell::RefCell;
use std::collections::BTreeMap;
mod interface;
mod annotation;
mod book;
mod archive;

#[derive(Default)]
struct Node {
    edges: BTreeMap<u16, usize>,
    word: u32,
}

#[derive(Default)]
struct Engine {
    input: Vec<u16>,
    nodes: Vec<Node>,
    output: Vec<u32>,
    children: Vec<Vec<u16>>,
    syllables: std::collections::BTreeSet<Vec<u16>>,
}

thread_local! { static ENGINE: RefCell<Engine> = RefCell::new(Engine::default()); }

#[no_mangle]
pub extern "C" fn input(len: usize) -> *mut u16 {
    ENGINE.with_borrow_mut(|e| {
        e.input.resize(len, 0);
        e.input.as_mut_ptr()
    })
}

#[no_mangle]
pub extern "C" fn reset_dictionary() {
    ENGINE.with_borrow_mut(|e| {
        e.nodes.clear();
        e.syllables.clear();
        e.nodes.push(Node::default());
    });
}

#[no_mangle]
pub extern "C" fn add_syllable() {
    ENGINE.with_borrow_mut(|e| { e.syllables.insert(e.input.clone()); });
}

#[no_mangle]
pub extern "C" fn split_syllables(want: usize) -> usize {
    ENGINE.with_borrow_mut(|e| {
        e.output.clear();
        let n = e.input.len();
        if want == 0 || want > n || n > want.saturating_mul(6) { return 0; }
        // Reader pinyin normally has just a few syllables. Memoize failed
        // suffixes to avoid repeating the same search on ambiguous readings.
        fn split(e: &mut Engine, at: usize, left: usize, failed: &mut std::collections::BTreeSet<(usize,usize)>) -> bool {
            if left == 0 { return at == e.input.len(); }
            let remaining = e.input.len()-at;
            if remaining < left || remaining > 6*left || failed.contains(&(at,left)) { return false; }
            for len in (1..=remaining.min(6)).rev() {
                if !e.syllables.contains(&e.input[at..at+len]) { continue; }
                e.output.push(len as u32);
                if split(e, at+len, left-1, failed) { return true; }
                e.output.pop();
            }
            failed.insert((at,left));
            false
        }
        split(e, 0, want, &mut Default::default());
        e.output.len()
    })
}

#[no_mangle]
pub extern "C" fn add_word(id: u32) {
    ENGINE.with_borrow_mut(|e| {
        let mut node = 0;
        for &unit in &e.input {
            node = match e.nodes[node].edges.get(&unit) {
                Some(&index) => index,
                None => {
                    let index = e.nodes.len();
                    e.nodes[node].edges.insert(unit, index);
                    e.nodes.push(Node::default());
                    index
                }
            };
        }
        e.nodes[node].word = id;
    });
}

fn is_reader_unit(unit: u16) -> bool {
    (0x3400..=0xfaff).contains(&unit)
}

// Each token is an exclusive end offset and a dictionary ID. Zero marks
// plain text, and negative IDs encode the UTF-16 unit of an unmatched hanzi.
#[no_mangle]
pub extern "C" fn tokenize() -> usize {
    ENGINE.with_borrow_mut(|e| {
        e.output.clear();
        let mut start = 0;
        while start < e.input.len() {
            let first = e.input[start];
            let mut end = start + 1;
            let mut id = 0;
            if is_reader_unit(first) {
                id = -(i32::from(first) + 1);
                let mut node = 0;
                for (offset, unit) in e.input[start..].iter().enumerate() {
                    let Some(&next) = e.nodes[node].edges.get(unit) else { break };
                    node = next;
                    if e.nodes[node].word != 0 {
                        id = e.nodes[node].word as i32;
                        end = start + offset + 1;
                    }
                }
            } else {
                while end < e.input.len() && !is_reader_unit(e.input[end]) { end += 1; }
            }
            e.output.extend([end as u32, id as u32]);
            start = end;
        }
        e.output.len()
    })
}

#[no_mangle]
pub extern "C" fn output() -> *const u32 {
    ENGINE.with_borrow(|e| e.output.as_ptr())
}

#[no_mangle]
pub extern "C" fn begin_graph(size: usize) {
    ENGINE.with_borrow_mut(|e| e.children = vec![Vec::new(); size]);
}

#[no_mangle]
pub extern "C" fn set_children(parent: usize) {
    ENGINE.with_borrow_mut(|e| e.children[parent].clone_from(&e.input));
}

#[no_mangle]
pub extern "C" fn grow_tree(root: usize) -> usize {
    ENGINE.with_borrow_mut(|e| {
        let graph = &e.children;
        let n = graph.len();
        let mut order = vec![root];
        let mut visited = vec![false; n];
        let mut incoming = vec![0; n];
        visited[root] = true;
        let mut cursor = 0;
        while cursor < order.len() {
            for &child in &graph[order[cursor]] {
                let k = usize::from(child);
                incoming[k] += 1;
                if !visited[k] {
                    visited[k] = true;
                    order.push(k);
                }
            }
            cursor += 1;
        }
        let mut queue = vec![root];
        let mut parent = vec![usize::MAX; n];
        let mut depth = vec![0; n];
        cursor = 0;
        while cursor < queue.len() {
            let current = queue[cursor];
            for &child in &graph[current] {
                let k = usize::from(child);
                if depth[current] + 1 > depth[k] {
                    parent[k] = current;
                    depth[k] = depth[current] + 1;
                }
                incoming[k] -= 1;
                if incoming[k] == 0 { queue.push(k); }
            }
            cursor += 1;
        }
        let mut sizes = vec![0u32; n];
        let mut heights = vec![0u32; n];
        let mut deepest_first = order.clone();
        deepest_first.sort_by_key(|&k| std::cmp::Reverse(depth[k]));
        for k in deepest_first {
            let p = parent[k];
            if p != usize::MAX && k != root {
                sizes[p] += sizes[k] + 1;
                heights[p] = heights[p].max(heights[k] + 1);
            }
        }
        e.output.clear();
        for k in order {
            e.output.extend([k as u32, parent[k] as u32, sizes[k], heights[k]]);
        }
        e.output.len()
    })
}
