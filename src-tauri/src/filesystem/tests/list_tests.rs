use super::*;
use std::fs;

#[test]
fn list_dir_returns_sorted_entries() {
    let dir = home_test_dir("list_dir");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::create_dir(dir.join("beta")).unwrap();
    fs::create_dir(dir.join("alpha")).unwrap();
    fs::write(dir.join("zebra.txt"), "").unwrap();
    fs::write(dir.join("apple.txt"), "").unwrap();

    let result = list_dir(ListDirRequest {
        path: dir.to_string_lossy().to_string(),
    });

    assert!(result.is_ok());
    let entries = result.unwrap();
    assert_eq!(entries.len(), 4);
    // Folders first, sorted
    assert_eq!(entries[0].name, "alpha");
    assert_eq!(entries[0].entry_type, EntryType::Folder);
    assert_eq!(entries[1].name, "beta");
    assert_eq!(entries[1].entry_type, EntryType::Folder);
    // Files second, sorted
    assert_eq!(entries[2].name, "apple.txt");
    assert_eq!(entries[2].entry_type, EntryType::File);
    assert_eq!(entries[3].name, "zebra.txt");
    assert_eq!(entries[3].entry_type, EntryType::File);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn list_dir_skips_hidden_files() {
    let dir = home_test_dir("hidden");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(".hidden"), "").unwrap();
    fs::write(dir.join("visible.txt"), "").unwrap();

    let result = list_dir(ListDirRequest {
        path: dir.to_string_lossy().to_string(),
    });

    assert!(result.is_ok());
    let entries = result.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "visible.txt");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn list_dir_rejects_nonexistent_path() {
    let result = list_dir(ListDirRequest {
        path: "/nonexistent/path/abc123".to_string(),
    });
    assert!(result.is_err());
}
