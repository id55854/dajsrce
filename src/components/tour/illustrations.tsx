import type { ReactNode } from "react";

/**
 * Flat, outlined people and objects for the walkthrough, drawn in the style of
 * the DajSrce campaign art: grey tops, charcoal trousers, pink skin, red hearts
 * and shoes, one dark outline, on a warm off-white ground.
 *
 * Everything is plain SVG built from a handful of primitives, so a scene costs
 * a few hundred bytes and needs no image request. The palette is fixed on
 * purpose: an illustration is a picture, not UI chrome, and it sits on its own
 * light panel in both themes.
 */

const C = {
  ground: "#F6F1EC",
  blob: "#ECE3DA",
  line: "#3A3A3A",
  skin: "#F6B6AC",
  shirt: "#A7A7A7",
  shirtDark: "#8C8C8C",
  dark: "#414141",
  red: "#F45B5B",
  redDark: "#D94444",
  paper: "#FFFFFF",
  paperLine: "#DDD5CE",
} as const;

const OUTLINE = { stroke: C.line, strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

type Point = readonly [number, number];
type ArmPath = readonly [Point, Point, Point];

type Pose = "down" | "hold" | "reach" | "wave" | "point" | "cheer" | "carry" | "phone";
type Hair = "short" | "long" | "bun" | "curly";
type Bottom = "pants" | "skirt" | "shorts";

type PersonProps = {
  /** Feet centre in scene coordinates. */
  x: number;
  y: number;
  /** Uniform scale; 1 is a 225-unit-tall adult. */
  s?: number;
  facing?: "left" | "right";
  build?: "tall" | "mid" | "kid";
  hair?: Hair;
  bottom?: Bottom;
  sleeve?: "long" | "short";
  shirt?: string;
  pose?: Pose;
  /** Drawn in the person's own coordinates, between the body and the front arm. */
  children?: ReactNode;
};

const HEIGHT = { tall: 250, mid: 225, kid: 180 } as const;

function arms(pose: Pose, sy: number): { front: ArmPath; back: ArmPath } {
  const down = {
    front: [[14, sy + 6], [20, sy + 42], [22, sy + 76]] as ArmPath,
    back: [[-14, sy + 6], [-19, sy + 42], [-17, sy + 76]] as ArmPath,
  };
  switch (pose) {
    case "hold":
      return {
        front: [[14, sy + 6], [28, sy + 42], [54, sy + 36]],
        back: [[-12, sy + 6], [2, sy + 44], [44, sy + 46]],
      };
    case "reach":
      return {
        front: [[14, sy + 6], [44, sy + 24], [76, sy + 22]],
        back: [[-12, sy + 6], [22, sy + 34], [64, sy + 34]],
      };
    case "wave":
      return { front: [[14, sy + 6], [34, sy - 12], [40, sy - 46]], back: down.back };
    case "point":
      return { front: [[14, sy + 6], [42, sy - 6], [70, sy - 26]], back: down.back };
    case "cheer":
      return {
        front: [[14, sy + 6], [32, sy - 20], [32, sy - 54]],
        back: [[-14, sy + 6], [-32, sy - 20], [-32, sy - 54]],
      };
    case "carry":
      return {
        front: [[14, sy + 6], [26, sy + 46], [48, sy + 58]],
        back: [[-12, sy + 6], [8, sy + 50], [40, sy + 62]],
      };
    case "phone":
      return { front: [[14, sy + 6], [32, sy + 36], [30, sy + 2]], back: down.back };
    default:
      return down;
  }
}

function pathOf(points: readonly Point[]): string {
  const [first, ...rest] = points;
  return `M${first[0]} ${first[1]}` + rest.map(([x, y]) => ` L${x} ${y}`).join("");
}

function sleevePath(arm: ArmPath, sleeve: "long" | "short"): string {
  const [shoulder, elbow, hand] = arm;
  if (sleeve === "short") {
    const mid: Point = [(shoulder[0] + elbow[0] * 1.2) / 2.2, (shoulder[1] + elbow[1] * 1.2) / 2.2];
    return pathOf([shoulder, mid]);
  }
  const cuff: Point = [elbow[0] + (hand[0] - elbow[0]) * 0.72, elbow[1] + (hand[1] - elbow[1]) * 0.72];
  return pathOf([shoulder, elbow, cuff]);
}

function Arm({ arm, sleeve, shirt }: { arm: ArmPath; sleeve: "long" | "short"; shirt: string }) {
  const full = pathOf(arm);
  const cloth = sleevePath(arm, sleeve);
  const hand = arm[2];
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={full} stroke={C.line} strokeWidth={14} />
      <path d={full} stroke={C.skin} strokeWidth={8} />
      <path d={cloth} stroke={C.line} strokeWidth={17} />
      <path d={cloth} stroke={shirt} strokeWidth={11} />
      <circle cx={hand[0]} cy={hand[1]} r={6.5} fill={C.skin} {...OUTLINE} />
    </g>
  );
}

function HairShape({ hair, cy, r }: { hair: Hair; cy: number; r: number }) {
  const top = (
    <path
      d={`M${-r} ${cy + 3} C${-r - 3} ${cy - r - 2} ${r * 0.4} ${cy - r - 10} ${r} ${cy - 6} L${r * 0.55} ${cy - 5} C${r * 0.2} ${cy - 10} ${-r * 0.3} ${cy - 9} ${-r * 0.45} ${cy + 5} Z`}
      fill={C.line}
    />
  );
  switch (hair) {
    case "long":
      return (
        <g fill={C.line}>
          {top}
          <path d={`M${-r} ${cy - 2} C${-r - 8} ${cy + 14} ${-r - 10} ${cy + 26} ${-r + 2} ${cy + 30} C${-r + 8} ${cy + 20} ${-r + 6} ${cy + 8} ${-r * 0.4} ${cy + 2} Z`} />
        </g>
      );
    case "bun":
      return (
        <g fill={C.line}>
          <circle cx={-r - 2} cy={cy + 2} r={9} />
          {top}
        </g>
      );
    case "curly":
      return (
        <g fill={C.line}>
          {top}
          <circle cx={-r * 0.5} cy={cy - r + 1} r={7} />
          <circle cx={r * 0.2} cy={cy - r - 3} r={7} />
          <circle cx={-r + 1} cy={cy - r * 0.35} r={6} />
        </g>
      );
    default:
      return top;
  }
}

export function Person({
  x,
  y,
  s = 0.62,
  facing = "right",
  build = "mid",
  hair = "short",
  bottom = "pants",
  sleeve = "short",
  shirt = C.shirt,
  pose = "down",
  children,
}: PersonProps) {
  const H = HEIGHT[build];
  const r = build === "kid" ? 17 : 18;
  const cy = -H + r;
  const sy = cy + r + 9;
  const wy = sy + H * 0.34;
  const legTop = bottom === "pants" ? wy : bottom === "skirt" ? wy + H * 0.26 : wy + H * 0.14;
  const { front, back } = arms(pose, sy);
  const f = facing === "left" ? -1 : 1;

  return (
    <g transform={`translate(${x} ${y}) scale(${s * f} ${s})`}>
      <Arm arm={back} sleeve={sleeve} shirt={C.shirtDark} />

      {/* Legs and shoes */}
      {bottom === "pants" ? (
        <path
          d={`M-19 ${wy} L19 ${wy} L19 -9 L3 -9 L1 ${wy + 26} L-1 ${wy + 26} L-3 -9 L-19 -9 Z`}
          fill={C.dark}
          {...OUTLINE}
        />
      ) : (
        <g fill={C.skin} {...OUTLINE}>
          <rect x={-14} y={legTop - 4} width={10} height={-legTop - 5} />
          <rect x={4} y={legTop - 4} width={10} height={-legTop - 5} />
        </g>
      )}
      {bottom === "skirt" ? (
        <path d={`M-19 ${wy - 2} L19 ${wy - 2} L25 ${legTop} L-25 ${legTop} Z`} fill={C.dark} {...OUTLINE} />
      ) : null}
      {bottom === "shorts" ? (
        <path d={`M-19 ${wy - 2} L19 ${wy - 2} L21 ${legTop} L-21 ${legTop} Z`} fill={C.dark} {...OUTLINE} />
      ) : null}
      <g fill={C.red} {...OUTLINE}>
        <path d="M-20 0 L-20 -8 Q-20 -12 -15 -12 L-4 -12 Q2 -7 6 -6 Q8 -3 7 0 Z" />
        <path d="M0 0 L0 -8 Q0 -12 5 -12 L16 -12 Q22 -7 26 -6 Q28 -3 27 0 Z" />
      </g>

      {/* Torso, neck, head */}
      <rect x={-5} y={cy + r - 5} width={10} height={14} fill={C.skin} {...OUTLINE} />
      <path
        d={`M-22 ${sy + 9} Q-22 ${sy} -12 ${sy} L12 ${sy} Q22 ${sy} 22 ${sy + 9} L19 ${wy} L-19 ${wy} Z`}
        fill={shirt}
        {...OUTLINE}
      />
      <ellipse cx={0} cy={cy} rx={r - 1} ry={r} fill={C.skin} {...OUTLINE} />
      <path d={`M${r - 2} ${cy - 1} q5 3 0 7`} fill={C.skin} {...OUTLINE} />
      <HairShape hair={hair} cy={cy} r={r} />

      {children}
      <Arm arm={front} sleeve={sleeve} shirt={shirt} />
    </g>
  );
}

/* ------------------------------------------------------------------ objects */

type At = { x: number; y: number; s?: number; rotate?: number };

function place({ x, y, s = 1, rotate = 0 }: At): string {
  return `translate(${x} ${y}) rotate(${rotate}) scale(${s})`;
}

export function Heart(props: At & { fill?: string }) {
  return (
    <path
      transform={place(props)}
      d="M0 34 C-34 12 -52 -6 -52 -22 C-52 -38 -38 -48 -24 -48 C-12 -48 -4 -40 0 -31 C4 -40 12 -48 24 -48 C38 -48 52 -38 52 -22 C52 -6 34 12 0 34 Z"
      fill={props.fill ?? C.red}
      {...OUTLINE}
    />
  );
}

export function Pin(props: At & { fill?: string; dot?: string }) {
  return (
    <g transform={place(props)}>
      <path
        d="M0 0 C-4 -9 -15 -17 -15 -29 A15 15 0 1 1 15 -29 C15 -17 4 -9 0 0 Z"
        fill={props.fill ?? C.red}
        {...OUTLINE}
      />
      <circle cx={0} cy={-29} r={6} fill={props.dot ?? C.paper} {...OUTLINE} strokeWidth={2.4} />
    </g>
  );
}

function Lines({ x, y, w, n, gap = 9 }: { x: number; y: number; w: number; n: number; gap?: number }) {
  return (
    <g stroke={C.paperLine} strokeWidth={4} strokeLinecap="round">
      {Array.from({ length: n }, (_, i) => (
        <line key={i} x1={x} y1={y + i * gap} x2={x + (i === n - 1 ? w * 0.6 : w)} y2={y + i * gap} />
      ))}
    </g>
  );
}

/** A form card: two fields and a red button. */
export function FormCard(props: At) {
  return (
    <g transform={place(props)}>
      <rect x={-46} y={-58} width={92} height={116} rx={10} fill={C.paper} {...OUTLINE} />
      <rect x={-34} y={-42} width={68} height={16} rx={5} fill={C.ground} {...OUTLINE} strokeWidth={2.2} />
      <rect x={-34} y={-16} width={68} height={16} rx={5} fill={C.ground} {...OUTLINE} strokeWidth={2.2} />
      <g fill={C.line}>
        <circle cx={-24} cy={-8} r={2.4} />
        <circle cx={-16} cy={-8} r={2.4} />
        <circle cx={-8} cy={-8} r={2.4} />
        <circle cx={0} cy={-8} r={2.4} />
      </g>
      <rect x={-34} y={12} width={68} height={18} rx={9} fill={C.red} {...OUTLINE} strokeWidth={2.2} />
      <Lines x={-20} y={44} w={40} n={1} />
    </g>
  );
}

export function Phone(props: At & { screen?: ReactNode }) {
  return (
    <g transform={place(props)}>
      <rect x={-22} y={-40} width={44} height={80} rx={8} fill={C.dark} {...OUTLINE} />
      <rect x={-17} y={-33} width={34} height={64} rx={4} fill={C.paper} />
      {props.screen}
    </g>
  );
}

export function Box(props: At & { heart?: boolean }) {
  return (
    <g transform={place(props)}>
      <path d="M-34 -20 L34 -20 L34 26 L-34 26 Z" fill="#C9A27E" {...OUTLINE} />
      <path d="M-38 -32 L38 -32 L38 -20 L-38 -20 Z" fill="#D8B592" {...OUTLINE} />
      <path d="M-6 -32 L6 -32 L6 26 L-6 26 Z" fill="#E7CDB2" {...OUTLINE} strokeWidth={2.2} />
      {props.heart === false ? null : <Heart x={-20} y={6} s={0.18} />}
    </g>
  );
}

export function Calendar(props: At & { mark?: number }) {
  const mark = props.mark ?? 9;
  return (
    <g transform={place(props)}>
      <rect x={-44} y={-40} width={88} height={82} rx={9} fill={C.paper} {...OUTLINE} />
      <path d="M-44 -22 L-44 -31 Q-44 -40 -35 -40 L35 -40 Q44 -40 44 -31 L44 -22 Z" fill={C.red} {...OUTLINE} />
      <g fill={C.line}>
        <rect x={-26} y={-48} width={6} height={16} rx={3} />
        <rect x={20} y={-48} width={6} height={16} rx={3} />
      </g>
      {Array.from({ length: 12 }, (_, i) => {
        const cx = -30 + (i % 4) * 20;
        const cy = -8 + Math.floor(i / 4) * 17;
        return i === mark ? (
          <Heart key={i} x={cx} y={cy + 2} s={0.13} />
        ) : (
          <rect key={i} x={cx - 5} y={cy - 5} width={10} height={10} rx={2.5} fill={C.paperLine} />
        );
      })}
    </g>
  );
}

export function Bell(props: At) {
  return (
    <g transform={place(props)}>
      <path d="M-26 18 C-20 10 -22 -4 -20 -12 C-17 -26 -8 -32 0 -32 C8 -32 17 -26 20 -12 C22 -4 20 10 26 18 Z" fill="#F2C14E" {...OUTLINE} />
      <path d="M-8 20 A8 8 0 0 0 8 20" fill={C.dark} {...OUTLINE} />
      <circle cx={0} cy={-35} r={4} fill="#F2C14E" {...OUTLINE} />
      <g fill="none" {...OUTLINE}>
        <path d="M-34 -18 Q-40 -6 -34 6" />
        <path d="M34 -18 Q40 -6 34 6" />
      </g>
      <circle cx={20} cy={-24} r={9} fill={C.red} {...OUTLINE} />
    </g>
  );
}

export function Envelope(props: At) {
  return (
    <g transform={place(props)}>
      <rect x={-40} y={-26} width={80} height={54} rx={6} fill={C.paper} {...OUTLINE} />
      <path d="M-38 -22 L0 6 L38 -22" fill="none" {...OUTLINE} />
      <Heart x={0} y={-2} s={0.2} />
    </g>
  );
}

export function Magnifier(props: At) {
  return (
    <g transform={place(props)}>
      <path d="M16 16 L38 38" stroke={C.line} strokeWidth={13} strokeLinecap="round" />
      <path d="M16 16 L38 38" stroke={C.dark} strokeWidth={7} strokeLinecap="round" />
      <circle cx={0} cy={0} r={24} fill="#E8F1F5" {...OUTLINE} />
      <path d="M-12 -8 A14 14 0 0 1 -2 -14" fill="none" stroke={C.paper} strokeWidth={4} strokeLinecap="round" />
    </g>
  );
}

export function Clipboard(props: At & { checks?: number }) {
  const checks = props.checks ?? 3;
  return (
    <g transform={place(props)}>
      <rect x={-34} y={-44} width={68} height={88} rx={7} fill={C.paper} {...OUTLINE} />
      <rect x={-14} y={-50} width={28} height={12} rx={4} fill={C.shirt} {...OUTLINE} />
      {Array.from({ length: 3 }, (_, i) => (
        <g key={i}>
          <rect x={-24} y={-26 + i * 22} width={11} height={11} rx={2.5} fill={i < checks ? C.red : C.paper} {...OUTLINE} strokeWidth={2.2} />
          <line x1={-6} y1={-20 + i * 22} x2={24} y2={-20 + i * 22} stroke={C.paperLine} strokeWidth={4} strokeLinecap="round" />
        </g>
      ))}
    </g>
  );
}

/** A small association house with a heart over the door. */
export function House(props: At & { flag?: boolean }) {
  return (
    <g transform={place(props)}>
      <rect x={-44} y={-40} width={88} height={70} fill={C.paper} {...OUTLINE} />
      <path d="M-54 -36 L0 -76 L54 -36 Z" fill={C.red} {...OUTLINE} />
      <rect x={-12} y={-4} width={24} height={34} rx={3} fill={C.dark} {...OUTLINE} />
      <rect x={-36} y={-24} width={16} height={16} rx={2} fill="#E8F1F5" {...OUTLINE} strokeWidth={2.2} />
      <rect x={20} y={-24} width={16} height={16} rx={2} fill="#E8F1F5" {...OUTLINE} strokeWidth={2.2} />
      <Heart x={0} y={-44} s={0.16} fill={C.paper} />
      {props.flag ? (
        <g>
          <line x1={34} y1={-58} x2={34} y2={-96} stroke={C.line} strokeWidth={3} strokeLinecap="round" />
          <path d="M34 -96 L60 -88 L34 -80 Z" fill={C.red} {...OUTLINE} />
        </g>
      ) : null}
    </g>
  );
}

/** A folded map sheet with a few roads and pins. */
export function MapSheet(props: At & { pins?: boolean }) {
  return (
    <g transform={place(props)}>
      <path d="M-70 -44 L-24 -54 L24 -44 L70 -54 L70 44 L24 54 L-24 44 L-70 54 Z" fill="#EAF3EC" {...OUTLINE} />
      <path d="M-24 -54 L-24 44 M24 -44 L24 54" stroke={C.paperLine} strokeWidth={2.5} />
      <path d="M-66 18 C-40 6 -20 26 6 10 C26 -2 44 8 66 -6" fill="none" stroke={C.paper} strokeWidth={7} strokeLinecap="round" />
      <path d="M-66 18 C-40 6 -20 26 6 10 C26 -2 44 8 66 -6" fill="none" stroke={C.paperLine} strokeWidth={2} strokeDasharray="4 5" />
      <path d="M-40 -46 C-34 -20 -44 10 -30 48" fill="none" stroke="#CFE3F0" strokeWidth={8} strokeLinecap="round" />
      {props.pins === false ? null : (
        <g>
          <Pin x={-6} y={-6} s={0.8} />
          <Pin x={44} y={-16} s={0.62} fill={C.shirt} />
          <Pin x={-50} y={4} s={0.62} fill={C.dark} dot={C.red} />
          <Pin x={30} y={34} s={0.5} fill={C.shirt} />
        </g>
      )}
    </g>
  );
}

export function Shield(props: At) {
  return (
    <g transform={place(props)}>
      <path d="M0 -40 L32 -28 L32 0 C32 22 16 36 0 42 C-16 36 -32 22 -32 0 L-32 -28 Z" fill={C.paper} {...OUTLINE} />
      <path d="M-13 1 L-3 11 L15 -9" fill="none" stroke={C.red} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

export function Book(props: At) {
  return (
    <g transform={place(props)}>
      <path d="M0 -30 C-18 -40 -40 -40 -56 -34 L-56 34 C-40 28 -18 28 0 38 Z" fill={C.paper} {...OUTLINE} />
      <path d="M0 -30 C18 -40 40 -40 56 -34 L56 34 C40 28 18 28 0 38 Z" fill={C.paper} {...OUTLINE} />
      <Lines x={-46} y={-18} w={36} n={4} gap={11} />
      <Lines x={10} y={-18} w={36} n={4} gap={11} />
    </g>
  );
}

export function Sliders(props: At) {
  const rows: [number, string][] = [
    [-16, C.red],
    [18, C.dark],
    [-4, C.shirtDark],
  ];
  return (
    <g transform={place(props)}>
      <rect x={-52} y={-40} width={104} height={80} rx={12} fill={C.paper} {...OUTLINE} />
      {rows.map(([knob, color], i) => (
        <g key={i}>
          <line x1={-36} y1={-20 + i * 20} x2={36} y2={-20 + i * 20} stroke={C.paperLine} strokeWidth={5} strokeLinecap="round" />
          <circle cx={knob} cy={-20 + i * 20} r={7} fill={color} {...OUTLINE} strokeWidth={2.4} />
        </g>
      ))}
    </g>
  );
}

export function Sparkle(props: At) {
  return (
    <path
      transform={place(props)}
      d="M0 -10 Q1.5 -1.5 10 0 Q1.5 1.5 0 10 Q-1.5 1.5 -10 0 Q-1.5 -1.5 0 -10 Z"
      fill="#F2C14E"
      {...OUTLINE}
      strokeWidth={2}
    />
  );
}

export function Plant(props: At) {
  return (
    <g transform={place(props)}>
      <path d="M0 0 C-2 -14 -2 -26 0 -40" fill="none" stroke={C.line} strokeWidth={3} />
      <path d="M0 -18 C-16 -22 -22 -34 -20 -42 C-8 -40 0 -32 0 -18 Z" fill="#8FB996" {...OUTLINE} />
      <path d="M0 -26 C14 -30 22 -42 20 -50 C8 -48 0 -40 0 -26 Z" fill="#8FB996" {...OUTLINE} />
      <path d="M-12 0 L12 0 L9 18 L-9 18 Z" fill={C.red} {...OUTLINE} transform="translate(0 -2)" />
    </g>
  );
}

export function Signpost(props: At) {
  return (
    <g transform={place(props)}>
      <rect x={-4} y={-90} width={8} height={90} fill={C.dark} {...OUTLINE} />
      <path d="M-4 -84 L-46 -84 L-58 -72 L-46 -60 L-4 -60 Z" fill={C.paper} {...OUTLINE} />
      <path d="M4 -54 L46 -54 L58 -42 L46 -30 L4 -30 Z" fill={C.red} {...OUTLINE} />
      <Heart x={-30} y={-71} s={0.14} />
      <g transform="translate(28 -42) scale(0.8)" fill={C.paper} {...OUTLINE} strokeWidth={2.4}>
        <path d="M-10 8 L-10 -4 L0 -12 L10 -4 L10 8 Z" />
      </g>
    </g>
  );
}

/** A profile card: avatar disc and a few lines. */
export function ProfileCard(props: At) {
  return (
    <g transform={place(props)}>
      <rect x={-50} y={-38} width={100} height={76} rx={10} fill={C.paper} {...OUTLINE} />
      <circle cx={-26} cy={-10} r={13} fill={C.skin} {...OUTLINE} />
      <path d="M-39 -12 C-40 -26 -18 -30 -13 -16 L-19 -15 C-22 -20 -30 -19 -32 -9 Z" fill={C.line} />
      <Lines x={-6} y={-16} w={42} n={2} gap={11} />
      <rect x={-38} y={14} width={34} height={12} rx={6} fill={C.red} {...OUTLINE} strokeWidth={2.2} />
      <rect x={4} y={14} width={34} height={12} rx={6} fill={C.ground} {...OUTLINE} strokeWidth={2.2} />
    </g>
  );
}

function Chat(props: At) {
  return (
    <g transform={place(props)}>
      <path d="M-26 -18 Q-26 -26 -18 -26 L18 -26 Q26 -26 26 -18 L26 4 Q26 12 18 12 L-6 12 L-16 22 L-14 12 L-18 12 Q-26 12 -26 4 Z" fill={C.paper} {...OUTLINE} />
      <Heart x={0} y={-6} s={0.2} />
    </g>
  );
}

/* ------------------------------------------------------------------- scenes */

function Scene({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <svg
      viewBox="0 0 320 190"
      className="block h-auto w-full"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <rect width={320} height={190} fill={C.ground} />
      <circle cx={70} cy={70} r={46} fill={C.blob} />
      <circle cx={262} cy={52} r={30} fill={C.blob} />
      <ellipse cx={160} cy={180} rx={150} ry={8} fill={C.blob} />
      {children}
    </svg>
  );
}

const SCENES = {
  welcome: () => (
    <Scene>
      <Person x={62} y={182} hair="bun" bottom="skirt" sleeve="long" pose="hold" s={0.58}>
        <Heart x={70} y={-150} s={0.95} />
      </Person>
      <Person x={160} y={182} build="tall" pose="reach" s={0.6} />
      <Heart x={222} y={92} s={0.62} rotate={-6} />
      <Person x={268} y={182} build="kid" hair="curly" bottom="shorts" facing="left" pose="reach" s={0.62} />
    </Scene>
  ),
  signIn: () => (
    <Scene>
      <FormCard x={212} y={100} s={1.05} />
      <Person x={100} y={182} hair="long" bottom="skirt" sleeve="long" pose="point" s={0.64} />
      <Sparkle x={272} y={36} s={0.9} />
      <Sparkle x={150} y={40} s={0.6} />
    </Scene>
  ),
  login: () => (
    <Scene>
      <Phone x={214} y={104} s={1.3} screen={<FormCard x={0} y={0} s={0.3} />} />
      <Person x={108} y={182} build="tall" pose="point" s={0.6} />
      <Heart x={268} y={48} s={0.3} rotate={12} />
    </Scene>
  ),
  signUp: () => (
    <Scene>
      <Envelope x={228} y={84} s={1.05} />
      <Person x={112} y={182} hair="curly" pose="reach" s={0.62} />
      <Sparkle x={282} y={40} s={0.8} />
      <Sparkle x={184} y={36} s={0.55} />
    </Scene>
  ),
  roleChoice: () => (
    <Scene>
      <Signpost x={160} y={180} s={1.05} />
      <Person x={70} y={182} hair="bun" bottom="skirt" sleeve="long" pose="wave" s={0.6} />
      <House x={262} y={150} s={0.62} />
    </Scene>
  ),
  claim: () => (
    <Scene>
      <Book x={214} y={104} s={1.05} />
      <Magnifier x={234} y={90} s={0.85} />
      <Person x={96} y={182} build="tall" pose="point" s={0.6} />
    </Scene>
  ),
  verify: () => (
    <Scene>
      <Shield x={218} y={92} s={1.25} />
      <Person x={104} y={182} hair="long" bottom="skirt" sleeve="long" pose="hold" s={0.62}>
        <Envelope x={60} y={-150} s={0.62} />
      </Person>
      <Sparkle x={276} y={40} s={0.8} />
    </Scene>
  ),
  mapSearch: () => (
    <Scene>
      <MapSheet x={210} y={104} s={1.05} />
      <Magnifier x={200} y={80} s={0.7} />
      <Person x={80} y={182} hair="short" pose="point" s={0.6} />
    </Scene>
  ),
  filters: () => (
    <Scene>
      <Sliders x={214} y={98} s={1.1} />
      <Person x={96} y={182} hair="bun" bottom="skirt" sleeve="long" pose="point" s={0.62} />
      <Heart x={284} y={40} s={0.26} />
    </Scene>
  ),
  mapPins: () => (
    <Scene>
      <MapSheet x={160} y={100} s={1.25} />
      <Person x={48} y={182} build="kid" hair="curly" bottom="shorts" pose="point" s={0.6} />
      <Person x={278} y={182} hair="long" bottom="skirt" sleeve="long" facing="left" pose="wave" s={0.6} />
    </Scene>
  ),
  needs: () => (
    <Scene>
      <House x={250} y={150} s={0.8} />
      <Person x={120} y={182} build="tall" pose="carry" s={0.6}>
        <Box x={62} y={-120} s={0.95} />
      </Person>
    </Scene>
  ),
  wizard: () => (
    <Scene>
      <Signpost x={214} y={180} s={1} />
      <Person x={100} y={182} hair="curly" pose="point" s={0.62} />
      <Sparkle x={278} y={46} s={0.8} />
    </Scene>
  ),
  pledge: () => (
    <Scene>
      <Person x={108} y={182} hair="bun" bottom="skirt" sleeve="long" pose="reach" s={0.62}>
        <Box x={98} y={-162} s={0.8} />
      </Person>
      <Person x={228} y={182} build="tall" facing="left" pose="reach" s={0.6} />
      <Heart x={170} y={40} s={0.3} />
    </Scene>
  ),
  volunteer: () => (
    <Scene>
      <Person x={72} y={182} hair="long" bottom="skirt" sleeve="long" pose="cheer" s={0.56} />
      <Person x={160} y={182} build="tall" pose="wave" s={0.58} />
      <Person x={250} y={182} build="kid" hair="curly" bottom="shorts" facing="left" pose="cheer" s={0.6} />
      <Heart x={116} y={40} s={0.26} rotate={-10} />
      <Heart x={208} y={34} s={0.22} rotate={10} />
    </Scene>
  ),
  calendar: () => (
    <Scene>
      <Calendar x={214} y={100} s={1.2} />
      <Person x={96} y={182} hair="short" pose="point" s={0.62} />
    </Scene>
  ),
  notifications: () => (
    <Scene>
      <Bell x={222} y={86} s={1.3} />
      <Person x={104} y={182} hair="bun" bottom="skirt" sleeve="long" pose="phone" s={0.62}>
        <Phone x={32} y={-176} s={0.4} />
      </Person>
      <Envelope x={282} y={150} s={0.42} rotate={-8} />
    </Scene>
  ),
  profile: () => (
    <Scene>
      <ProfileCard x={214} y={96} s={1.2} />
      <Person x={96} y={182} build="tall" pose="wave" s={0.6} />
      <Plant x={292} y={180} s={0.9} />
    </Scene>
  ),
  ngoNeeds: () => (
    <Scene>
      <Clipboard x={220} y={98} s={1.15} checks={2} />
      <Person x={100} y={182} hair="long" bottom="skirt" sleeve="long" pose="point" s={0.62} />
      <Box x={286} y={160} s={0.5} />
    </Scene>
  ),
  ngoPledges: () => (
    <Scene>
      <House x={96} y={150} s={0.8} flag />
      <Person x={218} y={182} build="tall" facing="left" pose="carry" s={0.58}>
        <Box x={62} y={-120} s={0.9} />
      </Person>
      <Box x={290} y={168} s={0.44} />
      <Chat x={170} y={40} s={0.9} />
    </Scene>
  ),
  ngoEvents: () => (
    <Scene>
      <Calendar x={236} y={96} s={1.05} mark={6} />
      <Person x={70} y={182} hair="bun" bottom="skirt" sleeve="long" pose="wave" s={0.56} />
      <Person x={140} y={182} build="kid" hair="curly" bottom="shorts" pose="cheer" s={0.58} />
    </Scene>
  ),
  ngoVolunteers: () => (
    <Scene>
      <Clipboard x={250} y={98} s={1} />
      <Person x={60} y={182} hair="long" bottom="skirt" sleeve="long" s={0.54} />
      <Person x={118} y={182} build="tall" s={0.56} />
      <Person x={176} y={182} hair="curly" pose="wave" s={0.54} />
    </Scene>
  ),
  ngoProfile: () => (
    <Scene>
      <House x={214} y={150} s={0.95} flag />
      <Person x={88} y={182} hair="short" pose="point" s={0.62} />
      <Sparkle x={296} y={50} s={0.8} />
    </Scene>
  ),
  done: () => (
    <Scene>
      <Person x={70} y={182} hair="bun" bottom="skirt" sleeve="long" pose="cheer" s={0.56} />
      <Person x={160} y={182} build="tall" pose="cheer" s={0.58}>
        <Heart x={0} y={-262} s={0.4} />
      </Person>
      <Person x={250} y={182} build="kid" hair="curly" bottom="shorts" facing="left" pose="cheer" s={0.6} />
      <Sparkle x={104} y={36} s={0.8} />
      <Sparkle x={222} y={30} s={0.7} />
    </Scene>
  ),
} as const;

export type SceneName = keyof typeof SCENES;

export function TourIllustration({ scene }: { scene: SceneName }) {
  const Render = SCENES[scene];
  return <Render />;
}
