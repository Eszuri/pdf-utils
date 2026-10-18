"""One JSON object per stdout line; diagnostics go to stderr."""
import argparse
import json
import sys

from pdf_word.convert import convert


def emit(event):
    print(json.dumps(event,ensure_ascii=True),flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('input')
    parser.add_argument('output')
    args=parser.parse_args()
    try:
        convert(args.input,args.output,emit)
    except Exception as error:
        emit({'kind':'error','message':str(error)})
        return 1
    return 0


if __name__=='__main__':
    sys.exit(main())
