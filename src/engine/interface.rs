use std::cell::RefCell;
use std::fmt::Write;
use super::ENGINE;

thread_local! { static HTML: RefCell<String> = RefCell::new(String::new()); }

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
