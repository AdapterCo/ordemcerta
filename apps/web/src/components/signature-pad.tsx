import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

/** Assinatura manuscrita em dispositivo (touch/mouse) → PNG base64. */
export function SignaturePad({ onChange, height = 160 }: { onChange: (dataUrl: string | null) => void; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = height * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
  }, [height]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        style={{ height, touchAction: 'none' }}
        className="w-full rounded-md border border-dashed border-slate-400 bg-white"
        aria-label="Área de assinatura"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = canvas.current!.getContext('2d')!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          canvas.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvas.current!.getContext('2d')!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          setEmpty(false);
          onChange(canvas.current!.toDataURL('image/png'));
        }}
      />
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{empty ? 'Assine dentro da área acima' : 'Assinatura registrada'}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            const c = canvas.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            setEmpty(true);
            onChange(null);
          }}
        >
          Limpar
        </Button>
      </div>
    </div>
  );
}
