//! Pure Piper text normalization for TTS (Phase 7b).
//!
//! No filesystem, no subprocess, no `AppHandle`. Depends only on
//! `pipeline::log::single_line` for line trimming.

use crate::pipeline::log::single_line;

pub fn normalize_spacing(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut first_line = true;
    for line in input.lines() {
        let trimmed_line = single_line(line);
        if !first_line {
            out.push('\n');
        }
        out.push_str(&trimmed_line);
        first_line = false;
    }
    out.trim().to_string()
}

fn piper_digit_word(digit: char) -> Option<&'static str> {
    match digit {
        '0' => Some("zero"),
        '1' => Some("one"),
        '2' => Some("two"),
        '3' => Some("three"),
        '4' => Some("four"),
        '5' => Some("five"),
        '6' => Some("six"),
        '7' => Some("seven"),
        '8' => Some("eight"),
        '9' => Some("nine"),
        _ => None,
    }
}

fn piper_hundreds_to_words(value: u16) -> String {
    let units = [
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    ];
    let teens = [
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
        "nineteen",
    ];
    let tens = [
        "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    ];

    let mut parts = Vec::new();
    let hundreds = value / 100;
    let remainder = value % 100;

    if hundreds > 0 {
        parts.push(format!("{} hundred", units[usize::from(hundreds)]));
    }

    if remainder >= 20 {
        if hundreds > 0 {
            parts.push("and".to_string());
        }
        let ten_index = usize::from(remainder / 10);
        let unit_index = usize::from(remainder % 10);
        if unit_index == 0 {
            parts.push(tens[ten_index].to_string());
        } else {
            parts.push(format!("{} {}", tens[ten_index], units[unit_index]));
        }
    } else if remainder >= 10 {
        if hundreds > 0 {
            parts.push("and".to_string());
        }
        parts.push(teens[usize::from(remainder - 10)].to_string());
    } else if remainder > 0 || parts.is_empty() {
        if hundreds > 0 && remainder > 0 {
            parts.push("and".to_string());
        }
        parts.push(units[usize::from(remainder)].to_string());
    }

    parts.join(" ")
}

pub fn piper_integer_to_words(value: u64) -> String {
    if value == 0 {
        return "zero".to_string();
    }

    let scales = [
        "",
        "thousand",
        "million",
        "billion",
        "trillion",
        "quadrillion",
        "quintillion",
    ];

    let mut remaining = value;
    let mut chunks = Vec::new();
    let mut scale_index = 0usize;

    while remaining > 0 {
        let chunk = (remaining % 1000) as u16;
        if chunk > 0 {
            let mut words = piper_hundreds_to_words(chunk);
            let scale = scales.get(scale_index).copied().unwrap_or("");
            if !scale.is_empty() {
                words.push(' ');
                words.push_str(scale);
            }
            chunks.push(words);
        }
        remaining /= 1000;
        scale_index += 1;
    }

    chunks.reverse();
    chunks.join(", ")
}

pub fn piper_digits_to_words(digits: &str) -> Option<String> {
    if digits.is_empty() {
        return None;
    }

    let mut out = Vec::new();
    for digit in digits.chars() {
        let word = piper_digit_word(digit)?;
        out.push(word);
    }

    Some(out.join(" "))
}

pub fn normalize_piper_numeric_token(token: &str) -> String {
    if token.is_empty() {
        return token.to_string();
    }

    let negative = token.starts_with('-');
    let raw = if negative { &token[1..] } else { token };

    if raw.is_empty() {
        return token.to_string();
    }

    let mut split = raw.split('.');
    let integer_raw = split.next().unwrap_or_default();
    let fractional_raw = split.next();
    if split.next().is_some() {
        return token.to_string();
    }

    let integer_digits = integer_raw.replace(',', "");
    if integer_digits.is_empty() || !integer_digits.chars().all(|ch| ch.is_ascii_digit()) {
        return token.to_string();
    }

    let mut words = if let Ok(parsed) = integer_digits.parse::<u64>() {
        piper_integer_to_words(parsed)
    } else if let Some(digit_words) = piper_digits_to_words(&integer_digits) {
        digit_words
    } else {
        return token.to_string();
    };

    if let Some(fractional) = fractional_raw {
        if !fractional.is_empty() {
            if !fractional.chars().all(|ch| ch.is_ascii_digit()) {
                return token.to_string();
            }
            if let Some(fraction_words) = piper_digits_to_words(fractional) {
                words.push_str(" point ");
                words.push_str(&fraction_words);
            }
        }
    }

    if negative {
        format!("minus {words}")
    } else {
        words
    }
}

fn previous_non_whitespace(chars: &[char], index: usize) -> Option<char> {
    if index == 0 {
        return None;
    }

    let mut cursor = index;
    while cursor > 0 {
        cursor -= 1;
        let candidate = chars[cursor];
        if !candidate.is_whitespace() {
            return Some(candidate);
        }
    }

    None
}

fn next_non_whitespace(chars: &[char], index: usize) -> Option<char> {
    let mut cursor = index + 1;
    while cursor < chars.len() {
        let candidate = chars[cursor];
        if !candidate.is_whitespace() {
            return Some(candidate);
        }
        cursor += 1;
    }
    None
}

fn is_math_operator_between_numbers(chars: &[char], index: usize) -> bool {
    let left = previous_non_whitespace(chars, index);
    let right = next_non_whitespace(chars, index);
    matches!(
        (left, right),
        (Some(l), Some(r)) if l.is_ascii_digit() && r.is_ascii_digit()
    )
}

pub fn normalize_piper_math_symbols(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut output = String::with_capacity(input.len() + 32);
    let mut index = 0usize;

    while index < chars.len() {
        let current = chars[index];
        let replacement = match current {
            '/' if is_math_operator_between_numbers(&chars, index) => Some(" divided by "),
            '=' if is_math_operator_between_numbers(&chars, index) => Some(" equals "),
            '+' if is_math_operator_between_numbers(&chars, index) => Some(" plus "),
            '-' if is_math_operator_between_numbers(&chars, index) => Some(" minus "),
            _ => None,
        };

        if let Some(replacement) = replacement {
            if !output.ends_with(' ') {
                output.push(' ');
            }
            output.push_str(replacement.trim());
            output.push(' ');
        } else {
            output.push(current);
        }

        index += 1;
    }

    output
}

fn is_numeric_token_start(chars: &[char], index: usize) -> bool {
    let current = chars[index];
    if current.is_ascii_digit() {
        return true;
    }

    if current != '-' || index + 1 >= chars.len() || !chars[index + 1].is_ascii_digit() {
        return false;
    }

    match previous_non_whitespace(chars, index) {
        Some(previous) => !previous.is_ascii_alphanumeric(),
        None => true,
    }
}

pub fn validate_tts_input_length(text: &str) -> Result<(), String> {
    let count = text.chars().count();
    if count > crate::constants::MAX_TTS_INPUT_LENGTH {
        return Err(format!(
            "TTS input text is too long ({count} characters). Maximum is {}.",
            crate::constants::MAX_TTS_INPUT_LENGTH
        ));
    }
    Ok(())
}

pub fn normalize_piper_text_for_tts(input: &str) -> String {
    let symbol_normalized = normalize_piper_math_symbols(input);
    let chars: Vec<char> = symbol_normalized.chars().collect();
    let mut output = String::with_capacity(symbol_normalized.len() * 2);
    let mut index = 0usize;

    while index < chars.len() {
        if is_numeric_token_start(&chars, index) {
            let start = index;
            index += 1;

            while index < chars.len() {
                let current = chars[index];
                if current.is_ascii_digit() {
                    index += 1;
                    continue;
                }
                if (current == ',' || current == '.')
                    && index > start
                    && chars[index - 1].is_ascii_digit()
                    && index + 1 < chars.len()
                    && chars[index + 1].is_ascii_digit()
                {
                    index += 1;
                    continue;
                }
                break;
            }

            let token: String = chars[start..index].iter().collect();
            output.push_str(&normalize_piper_numeric_token(&token));
            continue;
        }

        output.push(chars[index]);
        index += 1;
    }

    normalize_spacing(&output)
}

pub fn validate_piper_binary_path(path: &str) -> Result<(), String> {
    let path_str = path.trim();
    if path_str.is_empty() {
        return Err("Piper binary path is empty.".to_string());
    }

    if path_str.contains(|c: char| matches!(c, '\0' | '\n' | '\r')) {
        return Err("Piper binary path contains invalid characters.".to_string());
    }

    let path_buf = std::path::Path::new(path_str);
    let file_name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid piper binary path.".to_string())?;
    let file_name_lower = file_name.to_ascii_lowercase();

    let allowed_names = ["piper", "piper.exe"];

    if !allowed_names.contains(&file_name_lower.as_str()) {
        return Err(format!(
            "Invalid piper binary name '{}'. Expected one of: {:?}",
            file_name, allowed_names
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_tts_input_length() {
        let short = "Short text.";
        assert!(validate_tts_input_length(short).is_ok());

        let boundary = "a".repeat(crate::constants::MAX_TTS_INPUT_LENGTH);
        assert!(validate_tts_input_length(&boundary).is_ok());

        let long = "a".repeat(crate::constants::MAX_TTS_INPUT_LENGTH + 1);
        assert!(validate_tts_input_length(&long).is_err());
    }

    #[test]
    fn normalizes_math_heavy_piper_text() {
        let input = "5,000,000 - 200 = 4,999,800 and 200 / 30 = 6.67";
        let normalized = normalize_piper_text_for_tts(input);

        assert!(normalized.contains("five million"));
        assert!(normalized.contains("minus two hundred"));
        assert!(normalized.contains("equals"));
        assert!(normalized.contains("four million"));
        assert!(normalized.contains("nine hundred and ninety nine thousand"));
        assert!(normalized.contains("two hundred divided by thirty"));
        assert!(normalized.contains("six point six seven"));
    }

    #[test]
    fn keeps_punctuation_after_numeric_tokens() {
        let input = "Result: 4,999,800. Next: 6.67, then 30.";
        let normalized = normalize_piper_text_for_tts(input);

        assert!(normalized.contains("four million"));
        assert!(normalized.contains("eight hundred."));
        assert!(normalized.contains("six point six seven,"));
        assert!(normalized.ends_with("thirty."));
    }

    #[test]
    fn validates_piper_binary_path() {
        assert!(validate_piper_binary_path("piper").is_ok());
        assert!(validate_piper_binary_path("piper.exe").is_ok());
        assert!(validate_piper_binary_path("/usr/local/bin/piper").is_ok());
        assert!(validate_piper_binary_path("C:/Program Files (x86)/piper/piper.exe").is_ok());

        assert!(validate_piper_binary_path("bash").is_err());
        assert!(validate_piper_binary_path("piper\nbad").is_err());
    }
}
