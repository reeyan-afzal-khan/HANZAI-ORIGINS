//! The character map's engine: the words each character writes, and where
//! the map's boxes go.
use std::cell::RefCell;
use std::collections::BTreeMap;
use super::ENGINE;

#[derive(Default)]
struct Vocab {
    by: BTreeMap<u16, Vec<u32>>,
    level: Vec<u16>,
    freq: Vec<u32>,
}

thread_local! { static VOCAB: RefCell<Vocab> = RefCell::new(Vocab::default()); }

/// Every word, as [length, level, frequency (two units), its units…] one
/// after another in the input, numbered from 0 in that order. Each character
/// gets the words of two or more characters it is written in: the lower
/// level first, then the commoner, then in the order given. Returns how many
/// characters have words.
#[no_mangle]
pub extern "C" fn vocab_build() -> usize {
    ENGINE.with_borrow(|e| VOCAB.with_borrow_mut(|v| {
        let Vocab { by, level, freq } = v;
        by.clear();
        level.clear();
        freq.clear();
        let input = &e.input[..];
        let mut at = 0;
        let mut seen: Vec<u16> = Vec::with_capacity(8);
        while at + 4 <= input.len() {
            let n = usize::from(input[at]);
            let id = level.len() as u32;
            level.push(input[at + 1]);
            freq.push(u32::from(input[at + 2]) | (u32::from(input[at + 3]) << 16));
            let word = &input[at + 4..(at + 4 + n).min(input.len())];
            at += 4 + n;
            if n < 2 { continue; }
            seen.clear();
            for &unit in word {
                if seen.contains(&unit) { continue; }
                seen.push(unit);
                by.entry(unit).or_default().push(id);
            }
        }
        /* one key per word — level, frequency, then its number, so no two tie
           and the order is the same as a stable sort's */
        let key = |i: u32| (u64::from(level[i as usize]) << 48) | (u64::from(freq[i as usize].min(0x7fff_ffff)) << 17) | u64::from(i & 0x1ffff);
        for list in by.values_mut() {
            list.sort_unstable_by_key(|&i| key(i));
        }
        by.len()
    }))
}

/// The words a character is written in, as word numbers in the output.
#[no_mangle]
pub extern "C" fn vocab_of(unit: u32) -> usize {
    VOCAB.with_borrow(|v| ENGINE.with_borrow_mut(|e| {
        e.output.clear();
        if let Some(list) = u16::try_from(unit).ok().and_then(|u| v.by.get(&u)) {
            e.output.extend_from_slice(list);
        }
        e.output.len()
    }))
}

/// The map laid out as a horizontal tidy tree. The input is a box at a time,
/// breadth first — the core first, every box after the one it hangs from —
/// as [what it hangs from + 1 (0 for the core), width, height]. Columns are
/// as wide as their widest box and `gap_x` apart; a box's family is stacked
/// in the next column, `gap_y` apart, and the box sits at its middle — or at
/// its top, where the family is taller than both the box and `tall`, so a
/// big tree reads from the top down. The output is each box's x and y, in
/// the input's order.
#[no_mangle]
pub extern "C" fn map_layout(gap_x: u32, gap_y: u32, tall: u32) -> usize {
    ENGINE.with_borrow_mut(|e| {
        let n = e.input.len() / 3;
        let (gap_x, gap_y, tall) = (f64::from(gap_x), f64::from(gap_y), f64::from(tall));
        let mut w = vec![0.0; n];
        let mut h = vec![0.0; n];
        let mut depth = vec![0usize; n];
        let mut kids: Vec<Vec<usize>> = vec![Vec::new(); n];
        for i in 0..n {
            let p = usize::from(e.input[3 * i]);
            w[i] = f64::from(e.input[3 * i + 1]);
            h[i] = f64::from(e.input[3 * i + 2]);
            if p > 0 && p - 1 < i {
                depth[i] = depth[p - 1] + 1;
                kids[p - 1].push(i);
            }
        }
        let columns = depth.iter().copied().max().map_or(0, |d| d + 1);
        let mut col_w = vec![0.0f64; columns];
        for i in 0..n { col_w[depth[i]] = col_w[depth[i]].max(w[i]); }
        let mut col_x = vec![0.0f64; columns];
        for d in 1..columns { col_x[d] = col_x[d - 1] + col_w[d - 1] + gap_x; }
        /* how tall each family is: a box's after everything it hangs over */
        let mut sub = vec![0.0f64; n];
        let mut kids_h = vec![0.0f64; n];
        for i in (0..n).rev() {
            let list = &kids[i];
            kids_h[i] = list.iter().map(|&k| sub[k]).sum::<f64>() + gap_y * list.len().saturating_sub(1) as f64;
            sub[i] = h[i].max(kids_h[i]);
        }
        /* where each goes: a box before what hangs from it */
        let mut top = vec![0.0f64; n];
        e.output.clear();
        e.output.resize(2 * n, 0);
        for i in 0..n {
            let kids_top = top[i] + (sub[i] - kids_h[i]) / 2.0;
            let y = if !kids[i].is_empty() && kids_h[i] > h[i].max(tall) { kids_top } else { top[i] + (sub[i] - h[i]) / 2.0 };
            let mut at = kids_top;
            for &k in &kids[i] {
                top[k] = at;
                at += sub[k] + gap_y;
            }
            e.output[2 * i] = col_x[depth[i]].round() as i32 as u32;
            e.output[2 * i + 1] = y.round() as i32 as u32;
        }
        e.output.len()
    })
}
