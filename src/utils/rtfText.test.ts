import test from "node:test";
import assert from "node:assert/strict";
import { rtfLines } from "./rtfText";

// The header macOS TextEdit writes, as in the Hyster RFP that first showed this: every line of
// it used to appear in the upload preview as a row.
const TEXTEDIT_HEADER = String.raw`{\rtf1\ansi\ansicpg1252\cocoartf2870
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;\f1\fnil\fcharset0 Verdana-Bold;\f2\fnil\fcharset0 Verdana;
\f3\fswiss\fcharset0 ArialMT;}
{\colortbl;\red255\green255\blue255;\red26\green26\blue26;\red255\green255\blue255;\red0\green0\blue0;
\red243\green246\blue249;\red16\green60\blue192;\red251\green0\blue7;}
{\*\expandedcolortbl;;\cssrgb\c13333\c13333\c13333;\cssrgb\c100000\c100000\c100000;\cssrgb\c0\c0\c0;
\cssrgb\c96078\c97255\c98039;\cssrgb\c6667\c33333\c80000;\cssrgb\c100000\c0\c0;}
{\*\listtable{\list\listtemplateid1\listhybrid{\listlevel\levelnfc23\levelnfcn23\leveljc0\leveljcn0\levelfollow0\levelstartat0\levelspace360{\*\levelmarker \{disc\}}{\leveltext\leveltemplateid1\'01\uc0\u8226 ;}{\levelnumbers;}\fi-360\li720\lin720 }{\listname ;}\listid1}}
{\*\listoverridetable{\listoverride\listid1\listoverridecount0\ls1}}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx560\tx1120\tx1680\pardirnatural\partightenfactor0
`;

test("a TextEdit RFP reads as its text, not the font and colour tables", () => {
  const rtf = TEXTEDIT_HEADER + String.raw`\f0\fs24 \cf0 \
\pard\pardeftab720\partightenfactor0

\f1\b \cf2 \cb3 \expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec4 RPF\
\f2\b0 :\strokec2 \
Advertiser: Hyster-Yale\
}`;

  assert.deepEqual(rtfLines(rtf), ["RPF", ":", "Advertiser: Hyster-Yale"]);
});

test("TextEdit bullet lists keep their bullets and items", () => {
  const rtf = TEXTEDIT_HEADER + String.raw`\ls1\ilvl0{\listtext	\uc0\u8226 	}Connected TV\
{\listtext	\uc0\u8226 	}Online video\
}`;

  assert.deepEqual(rtfLines(rtf), ["•\tConnected TV", "•\tOnline video"]);
});

test("accented and curly-quote characters come through from either escape form", () => {
  const rtf = String.raw`{\rtf1\ansi\ansicpg1252 Caf\'e9 \'93launch\'94\par Na\u239?ve \u8212? 25\u8211-44\par}`;

  assert.deepEqual(rtfLines(rtf), ["Café “launch”", "Naïve — 25–44"]);
});

test("a table in an RTF brief keeps each row together, cells separated", () => {
  const rtf = String.raw`{\rtf1\ansi Audiences\par
\trowd\cellx3000\cellx6000\intbl Audience\cell Age\cell\row
\trowd\cellx3000\cellx6000\intbl Outdoor Moms\cell 25 - 44\cell\row
\pard Flight: Q1\par}`;

  assert.deepEqual(rtfLines(rtf), ["Audiences", "Audience | Age", "Outdoor Moms | 25 - 44", "Flight: Q1"]);
});

test("escaped braces and backslashes are text, and tabs inside a paragraph are kept", () => {
  const rtf = String.raw`{\rtf1\ansi Goal:\tab Store visits \{Q1\}\line Path: C:\\briefs\par}`;

  assert.deepEqual(rtfLines(rtf), ["Goal:\tStore visits {Q1}", "Path: C:\\briefs"]);
});

test("hyperlink targets are dropped and only the link text is kept", () => {
  const rtf = String.raw`{\rtf1\ansi Site: {\field{\*\fldinst{HYPERLINK "https://www.hyster.com/"}}{\fldrslt hyster.com}}\par}`;

  assert.deepEqual(rtfLines(rtf), ["Site: hyster.com"]);
});

test("a file that is not RTF is refused by name", () => {
  assert.throws(() => rtfLines("plain text, not rtf"), /not a readable RTF document/);
});
