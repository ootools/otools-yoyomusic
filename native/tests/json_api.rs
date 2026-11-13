use otools_yoyomusic_native::handle_json;
use serde_json::{json, Value};

fn invoke(method: &str, payload: Value) -> Value {
    handle_json(&serde_json::to_vec(&json!({ "method": method, "payload": payload })).unwrap())
}

fn assert_error(response: &Value, category: &str) {
    assert_eq!(response["ok"], false, "{response}");
    let error = response["error"].as_str().expect("error must be a string");
    assert!(error.contains(category), "unexpected error: {error}");
    assert!(
        response.get("data").is_none(),
        "error must not carry success data"
    );
}

#[test]
fn health_reports_the_plugin_version_and_actual_rust_platform() {
    assert_eq!(
        invoke("__otools_health__", json!({})),
        json!({
            "ok": true,
            "data": {
                "id": "otools-yoyomusic",
                "version": "0.1.2",
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "capabilities": ["lyrics.parse"]
            }
        })
    );
}

#[test]
fn shutdown_is_idempotent_and_leaves_no_worker_state() {
    for _ in 0..2 {
        assert_eq!(
            invoke("__otools_shutdown__", json!({})),
            json!({ "ok": true, "data": { "stopped": true } })
        );
    }
    assert_eq!(invoke("__otools_health__", json!({}))["ok"], true);
}

#[test]
fn unknown_methods_are_errors_including_file_io_requests() {
    for method in ["missing.method", "fs.readFile", "audio.open"] {
        let response = invoke(method, json!({ "path": "must-not-be-read.lrc" }));
        assert_error(&response, "unknown method");
        assert!(response["error"].as_str().unwrap().contains(method));
    }
}

#[test]
fn invalid_json_and_invalid_utf8_are_errors() {
    for input in [
        b"not JSON".as_slice(),
        b"{\"method\":".as_slice(),
        &[0xff, 0xfe],
    ] {
        assert_error(&handle_json(input), "JSON");
    }
}

#[test]
fn missing_or_non_string_methods_are_rejected() {
    for request in [
        json!(null),
        json!([]),
        json!({}),
        json!({ "method": 42 }),
        json!({ "method": "" }),
    ] {
        assert_error(
            &handle_json(&serde_json::to_vec(&request).unwrap()),
            "method",
        );
    }
}

#[test]
fn lyrics_require_text_and_do_not_accept_a_path_instead() {
    for payload in [
        json!(null),
        json!({}),
        json!({ "text": 42 }),
        json!({ "path": "must-not-be-read.lrc" }),
    ] {
        assert_error(&invoke("lyrics.parse", payload), "text");
    }
}

#[test]
fn lyrics_match_existing_multi_timestamp_offset_and_plain_text_semantics() {
    assert_eq!(
        invoke(
            "lyrics.parse",
            json!({ "text": "[ti:Song]\n[offset:500]\n[00:10.5][00:20]双时间\n普通文字" })
        ),
        json!({ "ok": true, "data": { "lines": [
            { "timeMs": 0, "text": "普通文字" },
            { "timeMs": 11000, "text": "双时间" },
            { "timeMs": 20500, "text": "双时间" }
        ] } })
    );
}

#[test]
fn lyrics_handle_bom_crlf_negative_offset_and_both_fraction_separators() {
    assert_eq!(
        invoke(
            "lyrics.parse",
            json!({ "text": "\u{feff}[Ti:Title]metadata is ignored\r\n[OFFSET : -750]\r\n[00:00.500]clamped\r\n[00:01:25]quarter\r\n[00:02.007]milliseconds" })
        )["data"]["lines"],
        json!([
            { "timeMs": 0, "text": "clamped" },
            { "timeMs": 500, "text": "quarter" },
            { "timeMs": 1257, "text": "milliseconds" }
        ])
    );
}

#[test]
fn lyrics_sort_stably_keep_timed_blank_lines_and_strip_bracket_tags() {
    assert_eq!(
        invoke(
            "lyrics.parse",
            json!({ "text": "[00:02]later\n[00:01]\n[00:01]first\n[00:01]second\n  plain [stage] text  " })
        )["data"]["lines"],
        json!([
            { "timeMs": 0, "text": "plain  text" },
            { "timeMs": 1000, "text": "" },
            { "timeMs": 1000, "text": "first" },
            { "timeMs": 1000, "text": "second" },
            { "timeMs": 2000, "text": "later" }
        ])
    );
}

#[test]
fn lyrics_use_the_first_offset_and_ignore_malformed_timestamp_tags() {
    assert_eq!(
        invoke(
            "lyrics.parse",
            json!({ "text": "[offset:100]\n[offset:900]\n[00:01.1234]untimed\n[999999999999999999999999999:01]oversized\n[0:1.5]valid" })
        )["data"]["lines"],
        json!([
            { "timeMs": 0, "text": "untimed" },
            { "timeMs": 0, "text": "oversized" },
            { "timeMs": 1600, "text": "valid" }
        ])
    );
}

#[test]
fn empty_lyrics_produce_no_lines() {
    assert_eq!(
        invoke("lyrics.parse", json!({ "text": "\n[ar:Artist]\n" })),
        json!({ "ok": true, "data": { "lines": [] } })
    );
}

#[test]
fn unclosed_brackets_are_not_timestamps_or_offsets() {
    assert_eq!(
        invoke(
            "lyrics.parse",
            json!({ "text": "[00:01]timed\n[00:02\n[offset:900" })
        )["data"]["lines"],
        json!([
            { "timeMs": 0, "text": "[00:02" },
            { "timeMs": 1000, "text": "timed" }
        ])
    );
}

#[test]
fn excessive_timestamp_fanout_is_rejected_before_allocating_unbounded_output() {
    let text = format!("{}{}", "[00:00]".repeat(2048), "x".repeat(8192));
    assert_error(
        &invoke("lyrics.parse", json!({ "text": text })),
        "lyrics output",
    );
}
