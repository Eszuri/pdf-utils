"""End-to-end standalone regression with Python removed from the child PATH."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('engine',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    env=os.environ.copy()
    env['PATH']=str(Path(env.get('SystemRoot',env.get('WINDIR','C:/Windows')))/'System32')
    env.pop('PYTHONPATH',None); env.pop('PYTHONHOME',None)
    start=time.monotonic()
    result=subprocess.run([str(args.engine.resolve()),str(args.source.resolve()),str(args.output.resolve())],
                          env=env,capture_output=True,text=True,timeout=180)
    events=[json.loads(line) for line in result.stdout.splitlines()]
    assert result.returncode==0,(result.stdout,result.stderr)
    assert events[-1]['kind']=='result'
    print(json.dumps({'standalone':events[-1],'elapsedSeconds':round(time.monotonic()-start,2)}))
    with tempfile.TemporaryDirectory(prefix='word-cancel-') as directory:
        root=Path(directory)
        target=root/'original.docx'; target.write_bytes(b'keep original')
        temporary=root/'.pdf-utils-cancel.docx'; temporary.touch()
        marker=root/'cancel'
        env.update(PDF_WORD_TEMP=str(temporary),PDF_WORD_CANCEL=str(marker))
        process=subprocess.Popen([str(args.engine.resolve()),str(args.source.resolve()),str(target)],
                                 env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            for line in process.stdout:
                event=json.loads(line)
                if event.get('phase')=='converting':
                    marker.touch(); break
            stdout,stderr=process.communicate(timeout=30)
            assert process.returncode!=0
            assert 'CANCELLED' in stdout,(stdout,stderr)
            assert target.read_bytes()==b'keep original'
            assert not temporary.exists()
            print('Standalone cancellation passed: destination preserved, temporary output removed')
        finally:
            if process.poll() is None:
                process.kill(); process.communicate()


if __name__=='__main__':
    main()
