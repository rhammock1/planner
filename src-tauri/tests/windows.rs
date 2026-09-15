//! Every webview the app builds leaves the page's drags alone.
//!
//! This is the one rule about a window that nothing else here can check. A
//! webview that keeps Tauri's drag-and-drop handler answers
//! `performDragOperation:` itself instead of handing the drag to WebKit, so
//! `dragover` and `drop` never reach the DOM at all. Nothing throws, nothing
//! is logged, and no test in the browser suite can see it - that harness runs
//! in a browser, where there is no handler to claim anything. What is left is
//! a card that lifts, follows the pointer, and springs back into the column
//! it came from, which is how the board's drag was found broken.
//!
//! So the check is on the source, because that is where the mistake is: a
//! window added later inherits the handler by default, and a default is not
//! something a reviewer sees. The app listens for no OS file drop anywhere -
//! there is no `DragDropEvent` in it - so there is no window this should be
//! read as an exception for. If one is ever wanted, it wants a line here too.

use std::fs;
use std::path::{Path, PathBuf};

/// Every `.rs` file under `src-tauri/src`, however deep.
fn sources(dir: &Path, found: &mut Vec<PathBuf>) {
    let listing = fs::read_dir(dir).unwrap_or_else(|e| panic!("could not read {dir:?}: {e}"));
    for entry in listing {
        let path = entry.expect("could not read an entry").path();
        if path.is_dir() {
            sources(&path, found);
        } else if path.extension().is_some_and(|e| e == "rs") {
            found.push(path);
        }
    }
}

#[test]
fn every_window_the_app_builds_leaves_the_page_its_drags() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    sources(&root, &mut files);
    assert!(!files.is_empty(), "no sources found under {root:?}");

    let mut builders = 0;
    for path in &files {
        let text = fs::read_to_string(path).expect("could not read a source file");
        // Each builder runs from its `new(` to the `build()` that ends the
        // chain, which is what a call has to appear inside to count.
        for (at, _) in text.match_indices("WebviewWindowBuilder::new(") {
            let rest = &text[at..];
            let end = rest
                .find(".build()")
                .unwrap_or_else(|| panic!("a builder in {path:?} never reaches .build()"));
            let chain = &rest[..end];
            builders += 1;
            assert!(
                chain.contains(".disable_drag_drop_handler()"),
                "a webview built in {path:?} keeps the drag-drop handler, \
                 so `dragover` and `drop` never reach its page",
            );
        }
    }

    // The popover, the spread window, quick add, and a plugin's own webview.
    // Named as a count so that deleting the rule cannot pass as a file that
    // simply stopped building windows.
    assert_eq!(builders, 4, "the app builds a different number of webviews than it did");
}
