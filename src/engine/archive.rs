//! EPUB ZIP directory. Offsets in the result refer to the original archive,
//! so compressed chapters and cover images can stay in browser memory.
use std::cell::RefCell;
use super::ENGINE;

thread_local! { static BYTES: RefCell<Vec<u8>> = RefCell::new(Vec::new()); }
thread_local! { static INFLATED: RefCell<Vec<u8>> = RefCell::new(Vec::new()); }

struct Bits<'a> { bytes: &'a [u8], bit: usize }
impl Bits<'_> {
    fn take(&mut self, count: usize) -> Option<usize> {
        let mut value = 0;
        for i in 0..count {
            let byte = self.bytes.get(self.bit / 8)?;
            value |= usize::from((byte >> (self.bit % 8)) & 1) << i;
            self.bit += 1;
        }
        Some(value)
    }
}

struct Huffman { counts: [usize;16], symbols: Vec<usize> }
impl Huffman {
    fn new(lengths: &[usize]) -> Option<Self> {
        let mut counts = [0;16];
        for &len in lengths { if len > 0 { *counts.get_mut(len)? += 1; } }
        let mut offsets = [0;16];
        let mut left = 1usize;
        for len in 1..16 {
            left = (left * 2).checked_sub(counts[len])?;
            offsets[len] = offsets[len-1] + counts[len-1];
        }
        let mut symbols = vec![0; lengths.len()];
        for (symbol,&len) in lengths.iter().enumerate() {
            if len > 0 { symbols[offsets[len]] = symbol; offsets[len] += 1; }
        }
        Some(Self { counts, symbols })
    }
    fn decode(&self, bits: &mut Bits) -> Option<usize> {
        let (mut code, mut first, mut index) = (0,0,0);
        for &count in &self.counts[1..] {
            code |= bits.take(1)?;
            if code < first + count { return self.symbols.get(index+code-first).copied(); }
            index += count;
            first = (first + count) << 1;
            code <<= 1;
        }
        None
    }
}

fn dynamic_tables(bits: &mut Bits) -> Option<(Huffman,Huffman)> {
    let literals = bits.take(5)? + 257;
    let distances = bits.take(5)? + 1;
    let count = bits.take(4)? + 4;
    let order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
    let mut codes = [0;19];
    for &i in &order[..count] { codes[i] = bits.take(3)?; }
    let alphabet = Huffman::new(&codes)?;
    let mut lengths = Vec::with_capacity(literals+distances);
    while lengths.len() < literals+distances {
        let (n,v) = match alphabet.decode(bits)? {
            c @ 0..=15 => (1,c),
            16 => (3+bits.take(2)?, *lengths.last()?),
            17 => (3+bits.take(3)?, 0),
            18 => (11+bits.take(7)?, 0),
            _ => return None,
        };
        if lengths.len()+n > literals+distances { return None; }
        lengths.resize(lengths.len()+n,v);
    }
    Some((Huffman::new(&lengths[..literals])?, Huffman::new(&lengths[literals..])?))
}

fn deflate(bytes: &[u8], out: &mut Vec<u8>) -> Option<()> {
    let mut bits = Bits { bytes, bit:0 };
    loop {
        let last = bits.take(1)?;
        let kind = bits.take(2)?;
        if kind == 0 {
            bits.bit = bits.bit.next_multiple_of(8);
            let n = bits.take(16)?;
            if bits.take(16)? != (n ^ 65535) { return None; }
            let start = bits.bit / 8;
            out.extend_from_slice(bytes.get(start..start+n)?);
            bits.bit += n*8;
        } else {
            let (lit,dist) = match kind {
                1 => {
                    let mut lengths = [8;288];
                    lengths[144..256].fill(9);
                    lengths[256..280].fill(7);
                    (Huffman::new(&lengths)?, Huffman::new(&[5;32])?)
                },
                2 => dynamic_tables(&mut bits)?,
                _ => return None,
            };
            loop {
                let sym = lit.decode(&mut bits)?;
                match sym {
                    0..=255 => out.push(sym as u8),
                    256 => break,
                    257..=285 => {
                        let n = match sym {
                            257..=264 => sym-254,
                            285 => 258,
                            _ => {
                                let extra = (sym-261)/4;
                                3 + ((4+(sym-265)%4) << extra) + bits.take(extra)?
                            },
                        };
                        let d = dist.decode(&mut bits)?;
                        if d > 29 { return None; }
                        let back = if d < 4 { d+1 } else {
                            let extra = d/2-1;
                            1 + ((2+d%2) << extra) + bits.take(extra)?
                        };
                        let start = out.len().checked_sub(back)?;
                        for i in start..start+n { out.push(out[i]); }
                    },
                    _ => return None,
                }
            }
        }
        if last != 0 { return Some(()); }
    }
}

#[no_mangle]
pub extern "C" fn inflate_raw() -> i32 {
    BYTES.with_borrow(|src| INFLATED.with_borrow_mut(|out| {
        out.clear();
        if deflate(src,out).is_none() { return -1; }
        out.len() as i32
    }))
}
#[no_mangle]
pub extern "C" fn inflated_ptr() -> *const u8 { INFLATED.with_borrow(|b| b.as_ptr()) }

#[no_mangle]
pub extern "C" fn archive_buffer(len: usize) -> *mut u8 {
    BYTES.with_borrow_mut(|b| { b.resize(len, 0); b.as_mut_ptr() })
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes(bytes[at..at+2].try_into().unwrap())
}
fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at+4].try_into().unwrap())
}

#[no_mangle]
pub extern "C" fn zip_trailer() -> i32 {
    BYTES.with_borrow(|b| {
        let Some(last) = b.len().checked_sub(22) else { return -1 };
        (0..=last).rev().find(|&i| u32_at(b,i) == 0x06054b50).map_or(-1, |i| i as i32)
    })
}

#[no_mangle]
pub extern "C" fn zip_directory(count: usize) -> usize {
    BYTES.with_borrow(|b| ENGINE.with_borrow_mut(|e| {
        e.output.clear();
        let mut at = 0;
        for _ in 0..count {
            if b.len()-at < 46 || u32_at(b,at) != 0x02014b50 { break; }
            let name = usize::from(u16_at(b,at+28));
            let len = 46 + name + usize::from(u16_at(b,at+30)) + usize::from(u16_at(b,at+32));
            if len > b.len()-at { break; }
            e.output.extend([(at+46) as u32, name as u32, u16_at(b,at+10).into(),
                u32_at(b,at+20), u32_at(b,at+24), u32_at(b,at+42)]);
            at += len;
        }
        e.output.len()
    }))
}
