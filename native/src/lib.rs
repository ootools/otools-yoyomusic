#![deny(unsafe_op_in_unsafe_fn)]

use serde_json::{json, Value};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;

const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_LYRICS_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

fn error(message: impl Into<String>) -> Value {
    json!({ "ok": false, "error": message.into() })
}

/// Dispatch an in-memory JSON request. No method reads files or starts workers.
pub fn handle_json(input: &[u8]) -> Value {
    if input.len() > MAX_REQUEST_BYTES {
        return error("invalid input buffer: request exceeds 1 MiB");
    }
    let request: Value = match serde_json::from_slice(input) {
        Ok(value) => value,
        Err(reason) => return error(format!("invalid request JSON: {reason}")),
    };
    let Some(method) = request
        .get("method")
        .and_then(Value::as_str)
        .filter(|method| !method.is_empty())
    else {
        return error("method is required and must be a non-empty string");
    };
    let data = match method {
        "__otools_health__" => json!({
            "id": "otools-yoyomusic",
            "version": env!("CARGO_PKG_VERSION"),
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "capabilities": ["lyrics.parse"]
        }),
        "__otools_shutdown__" => json!({ "stopped": true }),
        "lyrics.parse" => {
            let Some(text) = request
                .get("payload")
                .and_then(|payload| payload.get("text"))
                .and_then(Value::as_str)
            else {
                return error("lyrics.parse payload.text must be a string");
            };
            match parse_lrc(text) {
                Ok(data) => data,
                Err(reason) => return error(reason),
            }
        }
        _ => return error(format!("unknown method: {method}")),
    };
    json!({ "ok": true, "data": data })
}

struct LyricLine {
    time_ms: i64,
    text: String,
}

// Taking the last '[' before each ']' also recognizes an inner timestamp in
// malformed nested brackets, without repeatedly scanning unclosed brackets.
fn bracket_tags(text: &str) -> impl Iterator<Item = &str> {
    text.split_inclusive(']')
        .filter_map(|part| part.strip_suffix(']'))
        .filter_map(|part| part.rsplit_once('[').map(|(_, tag)| tag))
}

fn parse_timestamp(tag: &str) -> Option<i64> {
    let (minutes, rest) = tag.split_once(':')?;
    if minutes.is_empty() || !minutes.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let (seconds, fraction) = rest
        .split_once('.')
        .or_else(|| rest.split_once(':'))
        .map_or((rest, None), |(seconds, fraction)| {
            (seconds, Some(fraction))
        });
    if !(1..=2).contains(&seconds.len()) || !seconds.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let fraction_ms = match fraction {
        None => 0,
        Some(digits)
            if (1..=3).contains(&digits.len())
                && digits.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            digits.parse::<i64>().ok()? * [0, 100, 10, 1][digits.len()]
        }
        Some(_) => return None,
    };
    minutes
        .parse::<i64>()
        .ok()?
        .checked_mul(60_000)?
        .checked_add(seconds.parse::<i64>().ok()?.checked_mul(1_000)?)?
        .checked_add(fraction_ms)
}

fn strip_bracket_tags(mut raw: &str) -> String {
    let mut text = String::with_capacity(raw.len());
    while let Some(start) = raw.find('[') {
        text.push_str(&raw[..start]);
        let tail = &raw[start..];
        let Some(end) = tail.find(']') else {
            text.push_str(tail);
            return text;
        };
        raw = &tail[end + 1..];
    }
    text.push_str(raw);
    text
}

fn is_metadata(raw: &str) -> bool {
    raw.trim_start()
        .strip_prefix('[')
        .and_then(|tag| tag.split_once(':'))
        .is_some_and(|(name, _)| {
            !name.is_empty() && name.bytes().all(|byte| byte.is_ascii_alphabetic())
        })
}

fn push_line(
    lines: &mut Vec<LyricLine>,
    output_budget: &mut usize,
    time_ms: i64,
    text: &str,
) -> Result<(), &'static str> {
    // JSON escaping needs at most six bytes per input byte; allow room for the
    // keys, timestamp and punctuation before cloning text for each timestamp.
    let cost = text.len().saturating_mul(6).saturating_add(64);
    *output_budget = output_budget
        .checked_add(cost)
        .filter(|size| *size <= MAX_LYRICS_OUTPUT_BYTES)
        .ok_or("lyrics output exceeds size limit")?;
    lines.push(LyricLine {
        time_ms,
        text: text.to_owned(),
    });
    Ok(())
}

fn parse_lrc(text: &str) -> Result<Value, &'static str> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let offset = bracket_tags(text)
        .find_map(|tag| {
            let (name, value) = tag.split_once(':')?;
            if name.trim_end().eq_ignore_ascii_case("offset") {
                value.trim_start().parse::<i64>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);
    let mut lines = Vec::new();
    let mut output_budget = 0;
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        let content = strip_bracket_tags(raw);
        let content = content.trim();
        let mut timed = false;
        for time_ms in bracket_tags(raw).filter_map(parse_timestamp) {
            timed = true;
            push_line(
                &mut lines,
                &mut output_budget,
                time_ms.saturating_add(offset).max(0),
                content,
            )?;
        }
        if !timed && !content.is_empty() && !is_metadata(raw) {
            push_line(&mut lines, &mut output_budget, 0, content)?;
        }
    }
    lines.sort_by_key(|line| line.time_ms);
    let lines: Vec<Value> = lines
        .into_iter()
        .map(|line| json!({ "timeMs": line.time_ms, "text": line.text }))
        .collect();
    Ok(json!({ "lines": lines }))
}

/// Invoke the OTools JSON ABI and return an owned, non-NUL-terminated buffer.
/// A null output-length pointer returns null without inspecting the input.
///
/// # Safety
/// A non-null `output_len` must point to a writable, aligned `usize`. Unless
/// null or over the size limit, `input_ptr` must be readable for `input_len`
/// bytes for the duration of this call. Release the returned buffer once with
/// `otools_plugin_free`, using exactly the returned output length.
#[no_mangle]
pub unsafe extern "C" fn otools_plugin_invoke(
    input_ptr: *const u8,
    input_len: usize,
    output_len: *mut usize,
) -> *mut u8 {
    if output_len.is_null() {
        return ptr::null_mut();
    }
    unsafe { *output_len = 0 };
    let bytes = catch_unwind(AssertUnwindSafe(|| {
        let result = if input_ptr.is_null() || input_len > MAX_REQUEST_BYTES {
            error("invalid input buffer: null pointer or request exceeds 1 MiB")
        } else {
            handle_json(unsafe { std::slice::from_raw_parts(input_ptr, input_len) })
        };
        serde_json::to_vec(&result)
            .unwrap_or_else(|_| br#"{"ok":false,"error":"serialization failed"}"#.to_vec())
            .into_boxed_slice()
    }))
    .unwrap_or_else(|_| {
        br#"{"ok":false,"error":"native plugin panicked"}"#
            .to_vec()
            .into_boxed_slice()
    });
    let len = bytes.len();
    let output = Box::into_raw(bytes) as *mut u8;
    unsafe { *output_len = len };
    output
}

/// Release a response in the same allocator that created it. Null is a no-op.
///
/// # Safety
/// A non-null pointer must be a still-owned result of `otools_plugin_invoke`,
/// with its exact original length. It must not be freed twice or used afterward.
#[no_mangle]
pub unsafe extern "C" fn otools_plugin_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        unsafe { drop(Box::from_raw(ptr::slice_from_raw_parts_mut(ptr, len))) };
    }
}
