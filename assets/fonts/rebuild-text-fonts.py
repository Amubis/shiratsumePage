#!/usr/bin/env python3
"""Reproduce the self-hosted font packs from the pinned upstream source.

Requires FontTools 4.61.1 and Brotli 1.2.1. This script is an offline maintenance
utility; the website and its normal build do not execute Python or download fonts.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
from fontTools import subset
from fontTools.ttLib import TTFont


def expand_ranges(value):
    points = set()
    for item in value.split(','):
        bounds = item.strip().removeprefix('U+').split('-')
        start = int(bounds[0], 16)
        end = int(bounds[-1], 16)
        points.update(range(start, end + 1))
    return points


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Pinned NotoSansSC[wght].ttf')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--only', help='Rebuild just one manifest id, e.g. core')
    args = parser.parse_args()
    manifest = json.loads((Path(__file__).resolve().parent / 'text-fonts-manifest.json').read_text())
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != manifest['sourceSha256']:
        raise SystemExit('The source font does not match the pinned upstream hash.')
    args.output.mkdir(parents=True, exist_ok=True)
    entries = [entry for entry in manifest['files'] if not args.only or entry['id'] == args.only]
    if not entries:
        raise SystemExit('Unknown font pack id.')
    for entry in entries:
        chars = expand_ranges(entry['unicodeRange'])
        font = TTFont(args.source, recalcTimestamp=False)
        options = subset.Options()
        options.flavor = 'woff2'
        options.recalc_timestamp = False
        options.layout_features = ['*']
        options.name_IDs = ['*']
        options.name_languages = ['*']
        options.name_legacy = True
        cutter = subset.Subsetter(options=options)
        cutter.populate(unicodes=chars)
        cutter.subset(font)
        font.flavor = 'woff2'
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / entry['file']
            font.save(path)
            binary = path.read_bytes()
            if len(binary) != entry['bytes'] or hashlib.sha256(binary).hexdigest() != entry['sha256']:
                raise SystemExit(f"Rebuilt bytes differ for {entry['id']}; check the tool versions.")
            check = TTFont(path)
            if set(check.getBestCmap()) != chars:
                raise SystemExit(f"Actual cmap differs for {entry['id']}.")
            (args.output / entry['file']).write_bytes(binary)
        print(f"{entry['id']}: {entry['codepoints']} code points, {entry['bytes']} bytes, verified")


if __name__ == '__main__':
    main()
