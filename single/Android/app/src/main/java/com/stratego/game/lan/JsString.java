package com.stratego.game.lan;

/** Turns a Java string into a JavaScript string literal that is safe to paste into evaluateJavascript. */
public final class JsString {
    private JsString() {}

    public static String quote(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\u2028': sb.append("\\u2028"); break; // line separators end JavaScript statements
                case '\u2029': sb.append("\\u2029"); break;
                case '<': sb.append("\\u003c"); break;     // never lets "</script>" through
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c)); else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
