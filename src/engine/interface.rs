use std::cell::RefCell;
use std::fmt::Write;
use super::ENGINE;

static SHELL: &str = include_str!("shell.html");
thread_local! { static HTML: RefCell<String> = RefCell::new(String::new()); }

#[no_mangle]
pub extern "C" fn shell_html() -> *const u8 { SHELL.as_ptr() }
#[no_mangle]
pub extern "C" fn shell_len() -> usize { SHELL.len() }
#[no_mangle]
pub extern "C" fn html_ptr() -> *const u8 { HTML.with_borrow(|html| html.as_ptr()) }

// All learner or dictionary text is escaped before being placed in HTML.
fn escaped(html: &mut String, value: &str) {
    for c in value.chars() {
        match c {
            '&' => html.push_str("&amp;"), '<' => html.push_str("&lt;"),
            '>' => html.push_str("&gt;"), '"' => html.push_str("&quot;"),
            '\'' => html.push_str("&#39;"), _ => html.push(c),
        }
    }
}

#[no_mangle]
pub extern "C" fn font_card(selected: bool) -> usize {
    ENGINE.with_borrow(|e| HTML.with_borrow_mut(|html| {
        html.clear();
        let fields: Vec<String> = e.input.split(|&u| u == 0).map(String::from_utf16_lossy).collect();
        let [id, name, stack, note] = &fields[..] else { return 0 };
        html.push_str("<button class=\"fontcard\" data-font=\"");
        escaped(html,id);
        write!(html,"\" aria-pressed=\"{selected}\" title=\"").unwrap();
        escaped(html,name);
        html.push_str("\"><span class=\"fsample\" style=\"font-family:");
        escaped(html,stack);
        html.push_str("\">永 水 木 人</span><span class=\"fname\">");
        escaped(html,name);
        html.push_str("</span>");
        if !note.is_empty() {
            html.push_str("<small>");
            escaped(html,note);
            html.push_str("</small>");
        }
        html.push_str("</button>");
        html.len()
    }))
}

#[no_mangle]
pub extern "C" fn grid_cell(level: u32, known: u32, selected: bool, rank: u32, show_rank: bool) -> usize {
    ENGINE.with_borrow(|e| HTML.with_borrow_mut(|html| {
        let fields: Vec<String> = e.input.split(|&u| u == 0).map(String::from_utf16_lossy).collect();
        let [glyph, pinyin, meaning, short, mark] = &fields[..] else { return 0 };
        html.clear();
        write!(html, "<button class=\"cell v{level}").unwrap();
        html.push_str(match known { 2 => " mastered", 1 => " met", _ => "" });
        if selected { html.push_str(" on"); }
        html.push_str("\" data-csel=\"");
        escaped(html, glyph);
        html.push_str("\" title=\"");
        escaped(html, glyph);
        html.push(' ');
        escaped(html, pinyin);
        html.push_str(" — ");
        escaped(html, meaning);
        if rank > 0 { write!(html, " · frequency #{rank}").unwrap(); }
        html.push_str("\">");
        if show_rank && rank > 0 { write!(html, "<span class=\"cr\">#{rank}</span>").unwrap(); }
        if known > 0 {
            html.push_str("<span class=\"cst\">");
            // mark is a trusted SVG constant, supplied by the character-tree renderer.
            html.push_str(mark);
            html.push_str("</span>");
        }
        for (class, value) in [("ch", glyph), ("cp", pinyin), ("ce", short)] {
            write!(html, "<span class=\"{class}\">").unwrap();
            escaped(html, value);
            html.push_str("</span>");
        }
        html.push_str("</button>");
        html.len()
    }))
}
