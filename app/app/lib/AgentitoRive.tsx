"use client";

// The real agentito: a Rive character (public/agentito.riv, made with
// rivemcp -- "Onboarding" session, 8/6-8). The "Agentito" state machine
// exposes:
//   miradaX / miradaY (number 0-100): where the pupils are looking
//   gesto (number): what it's doing -- 0 nothing, 1 thinking (head tilted and
//     an eyebrow arched), 2 book, 3 notepad and pencil, 4 magnifying glass,
//     5 wrench turning a screw, 10 the phone (the portal never requests it:
//     it's the bottom of the idle staircase, below)
//   festejar / matear / bostezar (trigger): the celebration bounce, sipping
//     mate, and the bored yawn
//   tono, antena, accesorio, pupila, boca, piel, traje, cejas: the look's axes
// On top of that it carries float and blink as its own loops. The runtime is
// the "lite" one (vectors only) and the wasm is served from /public -- nothing
// goes out to a CDN. While it loads (or if something fails) the static face
// shows, which is the same drawing: the swap never jumps.

import { useEffect, useRef, useState } from "react";
import { useRive, useStateMachineInput, RuntimeLoader } from "@rive-app/react-canvas-lite";
import { AgentitoAvatar, type AgentitoLook } from "./agentito";

RuntimeLoader.setWasmUrl("/rive.wasm");

/** What the agent is doing. Decided by whoever shows it, not by the character.
 *
 *  The last five are the WORK gestures. Each one is TWO things at once: the
 *  pose (the .riv's animation, via the `gesto` input) and the gaze's path
 *  (code, moving miradaX/miradaY). They go together on purpose: the pose says
 *  WHAT it's doing and the gaze points at where the action is. While a
 *  gesture is set, the gaze stops following the cursor. */
export type AgentitoState =
  | "normal"    // follows the cursor and nothing else
  | "calm"      // nothing waiting on you: it sips some mate
  | "waiting"   // something needs your ok: every so often it glances at the sidebar
  | "thinking"  // tilts its head, arches an eyebrow, gaze drifts up
  | "reading"   // holds a book and reads it line by line; turns the page now and then
  | "writing"   // notepad and pencil: the pencil scribbles and it watches the tip
  | "searching" // a magnifying glass sweeping its face, with short, choppy glances
  | "doing";    // a wrench turning a screw, with a little tremor of effort

const WORK_GESTURES: AgentitoState[] = [
  "thinking", "reading", "writing", "searching", "doing",
];
const isWorking = (e: AgentitoState) => WORK_GESTURES.includes(e);

/** The .riv's `gesto` input. The order is the state machine's, not alphabetical. */
const GESTURE_NUMBER: Record<string, number> = {
  thinking: 1, reading: 2, writing: 3, searching: 4, doing: 5,
};

/** The phone. Deliberately not in GESTURE_NUMBER: it isn't a state the portal
 *  requests, it's the bottom of the idle staircase (below). */
const PHONE_GESTURE = 10;

type Props = {
  /** Counter: each increment fires the celebration trigger. */
  celebrations: number;
  look: AgentitoLook;
  state?: AgentitoState;
  className?: string;
};

export default function AgentitoRive(props: Props) {
  // Safe to read during render: the only thing that imports this module for
  // its VALUE is `AgentitoAnimated`'s effect (lib/agentito.tsx), and an effect
  // never runs on the server -- everything else imports it `import type`, which
  // is erased. It therefore always runs in the browser. It used to say
  // `next/dynamic` with ssr:false; 87cc977 removed that, and the guarantee now
  // rests on the importer, so a second, SSR-reachable importer would break it.
  const [still] = useState(
    () => typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  // With reduced-motion we do NOT mount Rive: the static drawing goes up
  // instead, which respects the look and saves the wasm too. Pausing the
  // runtime didn't work -- it ended up paused before the state machine
  // applied the axes, so the default violet agentito showed up instead of
  // the one the client chose.
  if (still) return <AgentitoAvatar look={props.look} className={props.className} />;
  return <AnimatedAgentito {...props} />;
}

// Past this distance from the character, the gaze is already maxed out.
// Shorter and it saturates right away (stops saying which direction); longer
// and the eyes barely move.
const GAZE_RANGE = 300;

// ── The idle staircase ──
// How long since the client last touched anything. This is about the USER,
// not the agent, which is why it lives here and not in the `state` prop: the
// portal knows if something's pending, not whether you went off to do
// something else. Only runs with `state === "calm"`: if something's
// waiting on your ok or the agent is working, it isn't time to yawn.
const IDLE_YAWN = 90_000;    // 1.5 min with no activity: the first yawn
const IDLE_PHONE = 240_000;  // 4 min: it gets bored and takes out its phone
const REPEAT_YAWN = 50_000;
// How long `tomarMate` lasts (260 frames at 60fps), with a bit extra for the
// exit crossfade. It's the window during which the yawn CANNOT fire.
const MATE_DURATION = 4_600;

// Moving the mouse counts as "you're here" so it doesn't take out the phone
// while you're reading, but it does NOT put the phone away: if a mousemove
// cut the gesture short, putting it away would never be seen (you always move
// the mouse BEFORE clicking). Once it's hooked on the phone, only a
// deliberate action wakes it up.
const ACTIVITY_EVENTS = ["mousemove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
const DELIBERATE_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

function AnimatedAgentito({ celebrations, look, state = "normal", className }: Props) {
  // While it's looking at the badge, the cursor doesn't get a say: otherwise
  // they'd fight over it.
  const lookingAtBadge = useRef(false);
  // Hooked on the phone (the bottom of the idle staircase).
  const [distracted, setDistracted] = useState(false);
  // When the last sip started. The yawn needs this: both use `bocaChupa`
  // (mate as a little mouth around the straw, the yawn scaled up into an
  // oval) and the yawn runs on a higher layer, so if they land together the
  // mouth opens huge WITH THE STRAW STILL IN IT. They collide on their own
  // about 1 in every 12 yawns, because the two clocks are independent.
  const lastMate = useRef(0);
  // Where the character sits on screen: the gaze is computed FROM HERE, not
  // from the window's center. Otherwise it looks crooked as soon as it's off
  // center (for instance, top-left, on Home).
  const box = useRef<HTMLDivElement>(null);

  const { rive, RiveComponent } = useRive({
    src: "/agentito.riv",
    stateMachines: "Agentito",
    autoplay: true,
  });
  // The input names are baked into public/agentito.riv: they stay Spanish.
  const gazeX = useStateMachineInput(rive, "Agentito", "miradaX");
  const gazeY = useStateMachineInput(rive, "Agentito", "miradaY");
  const gestureInput = useStateMachineInput(rive, "Agentito", "gesto");
  const celebrateTrigger = useStateMachineInput(rive, "Agentito", "festejar");
  const toneInput = useStateMachineInput(rive, "Agentito", "tono");
  const antennaInput = useStateMachineInput(rive, "Agentito", "antena");
  const accessoryInput = useStateMachineInput(rive, "Agentito", "accesorio");
  const pupilInput = useStateMachineInput(rive, "Agentito", "pupila");
  const mouthInput = useStateMachineInput(rive, "Agentito", "boca");
  const skinInput = useStateMachineInput(rive, "Agentito", "piel");
  const suitInput = useStateMachineInput(rive, "Agentito", "traje");
  const browsInput = useStateMachineInput(rive, "Agentito", "cejas");
  const mateTrigger = useStateMachineInput(rive, "Agentito", "matear");
  const yawnTrigger = useStateMachineInput(rive, "Agentito", "bostezar");

  useEffect(() => {
    if (toneInput) toneInput.value = look.tone;
    if (antennaInput) antennaInput.value = look.antenna;
    if (accessoryInput) accessoryInput.value = look.accessory;
    if (pupilInput) pupilInput.value = look.pupil;
    if (mouthInput) mouthInput.value = look.mouth;
    if (skinInput) skinInput.value = look.skin;
    if (suitInput) suitInput.value = look.suit;
    if (browsInput) browsInput.value = look.brows;
  }, [look, toneInput, antennaInput, accessoryInput, pupilInput, mouthInput, skinInput, suitInput, browsInput]);

  useEffect(() => {
    if (celebrations > 0) celebrateTrigger?.fire();
  }, [celebrations, celebrateTrigger]);

  // When nothing's waiting on your ok, it sips some mate. The first one at
  // ~20s on screen; after that whenever it feels like it (45s-2min).
  useEffect(() => {
    if (!mateTrigger || state !== "calm") return;
    let t: ReturnType<typeof setTimeout>;
    const schedule = (ms: number) => {
      t = setTimeout(() => {
        mateTrigger.fire();
        lastMate.current = Date.now();
        schedule(45_000 + Math.random() * 75_000);
      }, ms);
    };
    schedule(20_000 + Math.random() * 15_000);
    return () => clearTimeout(t);
  }, [mateTrigger, state]);

  // ── The idle staircase: mate -> yawn -> the phone ──
  // A single clock: any activity resets it to zero and reschedules both
  // steps. Putting the phone away isn't scheduled: the click fires it.
  useEffect(() => {
    if (state !== "calm") {
      setDistracted(false);
      return;
    }
    let yawnTimer: ReturnType<typeof setTimeout>;
    let phoneTimer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      clearTimeout(yawnTimer);
      clearTimeout(phoneTimer);
      // The yawn keeps repeating as long as nothing happens; the phone is the
      // end of the road and stays until something interrupts it.
      const yawnLoop = () => {
        // If it's mid-sip, the yawn waits for it to finish (see `lastMate`).
        const sipping = Date.now() - lastMate.current < MATE_DURATION;
        if (!sipping) {
          try { yawnTrigger?.fire(); } catch { /* the runtime is gone */ }
        }
        yawnTimer = setTimeout(
          yawnLoop,
          sipping ? MATE_DURATION : REPEAT_YAWN + Math.random() * 20_000,
        );
      };
      yawnTimer = setTimeout(yawnLoop, IDLE_YAWN);
      phoneTimer = setTimeout(() => setDistracted(true), IDLE_PHONE);
    };

    const onIdleActivity = () => {
      // With the phone out, mousemove does NOT interrupt it (it's hooked, it
      // doesn't see you): it only reschedules for whenever it puts it away
      // again.
      schedule();
    };
    const onDeliberateActivity = () => {
      // This is the trick: it sees you, puts the phone away right away and
      // goes back to normal. The .riv's own `guardarCelu` fires on its own
      // once it stops being gesture 10.
      setDistracted(false);
      schedule();
    };

    schedule();
    for (const ev of ACTIVITY_EVENTS) {
      const isDeliberate = (DELIBERATE_EVENTS as readonly string[]).includes(ev);
      window.addEventListener(ev, isDeliberate ? onDeliberateActivity : onIdleActivity, { passive: true });
    }
    return () => {
      clearTimeout(yawnTimer);
      clearTimeout(phoneTimer);
      for (const ev of ACTIVITY_EVENTS) {
        const isDeliberate = (DELIBERATE_EVENTS as readonly string[]).includes(ev);
        window.removeEventListener(ev, isDeliberate ? onDeliberateActivity : onIdleActivity);
      }
    };
  }, [state, yawnTrigger]);

  // If something's waiting on your ok, every so often it glances at the
  // sidebar -- where the approvals badge is -- and looks back.
  useEffect(() => {
    if (!gazeX || !gazeY || state !== "waiting") return;
    let there: ReturnType<typeof setTimeout>;
    let back: ReturnType<typeof setTimeout>;
    const cycle = () => {
      there = setTimeout(() => {
        lookingAtBadge.current = true;
        // Bottom left: the approvals badge sits in the sidebar, lower than
        // the greeting where the character lives.
        gazeX.value = 5;
        gazeY.value = 68;
        back = setTimeout(() => {
          lookingAtBadge.current = false;
          gazeX.value = 50;
          gazeY.value = 50;
          cycle();
        }, 1300);
      }, 6000 + Math.random() * 5000);
    };
    cycle();
    return () => {
      clearTimeout(there);
      clearTimeout(back);
      lookingAtBadge.current = false;
    };
  }, [gazeX, gazeY, state]);

  // ── Work gestures, part 1: the pose ──
  // The .riv handles picking it up and holding it (the state machine
  // crossfades smoothly between gestures, 220ms). Here we only say which one.
  // Written in the effect's body, NEVER in the cleanup: on unmount,
  // `useRive`'s cleanup has already destroyed the instance, and writing
  // afterward crashes the whole screen.
  useEffect(() => {
    if (!gestureInput) return;
    try {
      // The phone wins over idling, but never over a requested gesture: if
      // work arrives while it was distracted, it puts the phone away and gets
      // to it.
      gestureInput.value = distracted ? PHONE_GESTURE : (GESTURE_NUMBER[state] ?? 0);
    } catch {
      /* the runtime is gone; the character is decoration, it can't take down the chat */
    }
  }, [gestureInput, state, distracted]);

  // ── Work gestures, part 2: the gaze ──
  // The point is that they TELL THE TRUTH: the chat knows which tool is
  // running and picks the gesture, it doesn't rotate at random. While one is
  // set, the cursor doesn't get a say. Each path points at WHERE ITS OBJECT
  // IS.
  useEffect(() => {
    if (!gazeX || !gazeY || !isWorking(state)) return;
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const s = (t - t0) / 1000;
      let x = 50;
      let y = 50;
      // WATCH THE AMPLITUDES: the chat's avatar is 28px, so the gaze's WHOLE
      // range is ~2px on screen. Measured: below +-8 the movement is
      // sub-pixel and invisible. That's why the gestures here go exaggerated
      // and are told apart by AMPLITUDE and SPEED, not by nuance.
      switch (state) {
        case "reading": {
          // One line: sweeps slowly and snaps back fast to the margin.
          const p = (s % 1.6) / 1.6;
          x = p < 0.8 ? 18 + (p / 0.8) * 64 : 82 - ((p - 0.8) / 0.2) * 64;
          y = 62 + Math.sin(s * 0.7) * 5; // y drifts down the page
          break;
        }
        case "thinking":
          // Up and to the right, on the side of the arched eyebrow, drifting.
          x = 68 + Math.sin(s * 0.5) * 16;
          y = 22 + Math.cos(s * 0.38) * 10;
          break;
        case "writing":
          // Right down at the pencil's tip.
          x = 50 + Math.sin(s * 2.4) * 14;
          y = 80 + Math.sin(s * 1.2) * 4;
          break;
        case "searching": {
          // Here the magnifying glass is moved by the .riv, not the code: it
          // sweeps from the right to the center and back, in 2.8s. The eyes
          // FOLLOW it -- at 70%, not locked on -- because if they looked
          // elsewhere while it passes over the face it would look very odd.
          // The timings are `gestoBuscando`'s keyframes converted to seconds
          // (at 60fps: still until f12, sweeps until f74, waits until f94,
          // returns by f156, still until f168). They start together because
          // both come out of the same state change, and both run against the
          // real clock: they never drift apart.
          const p = s % 2.8;
          const easeInOut = (u: number) => u * u * (3 - 2 * u); // ~ the .riv's own easeInOut
          let magnifierX: number;
          if (p < 0.2) magnifierX = 95;
          else if (p < 1.233) magnifierX = 95 - 129 * easeInOut((p - 0.2) / 1.033);
          else if (p < 1.567) magnifierX = -34;
          else if (p < 2.6) magnifierX = -34 + 129 * easeInOut((p - 1.567) / 1.033);
          else magnifierX = 95;
          const magnifierY = 25 + 19 * Math.sin((p / 2.8) * Math.PI);
          // 184 and 176 are the body's semi-axes: they convert the object's
          // position to the gaze's 0-100 scale.
          x = 50 + (magnifierX / 184) * 35 + Math.sin(s * 6) * 3; // + a little tremor
          y = 50 + (magnifierY / 176) * 35;
          break;
        }
        case "doing":
          // Down and to the right, looking at the wrench: short, FAST ticks.
          // Told apart from "reading" by speed, not size: still didn't work --
          // at 28px, still and "idle" look the same.
          x = 62 + Math.sin(s * 9) * 10;
          y = 62 + Math.sin(s * 7) * 5;
          break;
      }
      // The runtime can be gone between frames (Rive restarts, the component
      // unmounts): writing to a dead input throws "Cannot set properties of
      // null" and takes down the client's ENTIRE screen with it. If it
      // happens, silently stop the loop -- the character is decoration, it
      // can't take down the chat.
      try {
        gazeX.value = x;
        gazeY.value = y;
      } catch {
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Only stop the loop. Do NOT write to the inputs here: `useRive` is
    // declared BEFORE this effect, so on unmount its cleanup runs first and
    // destroys the instance -- writing afterward crashes with "Cannot set
    // properties of null". And there's no need to: if another gesture starts
    // it writes its own values, and if the cursor takes over next it writes
    // on the first movement.
    return () => cancelAnimationFrame(raf);
  }, [gazeX, gazeY, state]);

  // With the phone out, the .riv itself drives the gaze (pupils reading the
  // screen): we leave it parked looking at the device and stop following the
  // cursor. Parking it isn't redundant with the keyframes: the gaze layers run
  // afterward and would win anyway, and then the eyes would snap back to the
  // front with the phone still in hand.
  useEffect(() => {
    if (!gazeX || !gazeY || !distracted) return;
    try {
      gazeX.value = 58;
      gazeY.value = 82;
    } catch {
      /* the runtime is gone */
    }
  }, [gazeX, gazeY, distracted]);

  useEffect(() => {
    if (!gazeX || !gazeY || isWorking(state) || distracted) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const onMove = (e: MouseEvent) => {
      if (lookingAtBadge.current) return;
      const r = box.current?.getBoundingClientRect();
      if (!r || r.width === 0) return;
      // Vector from the character's face to the cursor: the angle gives the
      // direction and the distance gives the intensity (with the cursor right
      // on it, it looks straight ahead; far away, it maxes out).
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d < 1) { gazeX.value = 50; gazeY.value = 50; return; }
      const strength = Math.min(1, d / GAZE_RANGE);
      gazeX.value = 50 + (dx / d) * strength * 50;
      gazeY.value = 50 + (dy / d) * strength * 50;
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [gazeX, gazeY, state, distracted]);

  // With no cursor (touch), the gaze would stay locked forward: a slow drift.
  useEffect(() => {
    if (!gazeX || !gazeY || isWorking(state) || distracted) return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    let raf = 0;
    const tick = (t: number) => {
      if (!lookingAtBadge.current) {
        gazeX.value = 50 + 26 * Math.sin(t / 1700);
        gazeY.value = 50 + 16 * Math.sin(t / 2600);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gazeX, gazeY, state, distracted]);

  return (
    <div ref={box} className={`relative ${className ?? ""}`}>
      {!rive && <AgentitoAvatar look={look} alive className="absolute inset-0 h-full w-full" />}
      <RiveComponent className={`h-full w-full ${rive ? "" : "opacity-0"}`} />
    </div>
  );
}
