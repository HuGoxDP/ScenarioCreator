// scripts/helpers/CameraSetup.ts
// ============================================================
// Camera rig: Camera + Brain + 3 Virtual Cameras.
// Scenario calls createCameraRig() and gets back a simple
// interface to switch modes — no Cinemachine details leak out.
// ============================================================

import {
    GameObject, Camera, Vector3, Color, Transform,
    CameraClearFlags,

    // Cinemachine
    CinemachineBrain, CinemachineVirtualCamera, CinemachineBlendStyle,
    CinemachineOrbitalBody, CinemachineOrbitalAim,
    CinemachineFlyBody, CinemachinePOVAim,
    CinemachineFollowBody, CinemachineHardLookAtAim,
} from "WebEngineTS";

// ==================== PUBLIC INTERFACE ====================

/**
 * Simple facade for camera control. Scenario uses this
 * to switch camera modes without touching Cinemachine directly.
 */
export interface ICameraRig {
    /** Switch to orbit camera (mouse drag to rotate, scroll to zoom). */
    activateOrbit(): void;

    /** Switch to fly/FPS camera (WASD + mouse look). */
    activateFly(): void;

    /** Switch to follow camera tracking a target transform. */
    activateFollow(target: Transform): void;

    /**
     * Orbit one body close up, at a distance scaled to its own size.
     *
     * The point of this over {@link activateFollow} is that follow has a fixed
     * offset — the same five units from the Sun as from the Moon, and always from
     * the same side. Inspect keeps the mouse controls: drag to change the angle,
     * wheel to change the distance, both bounded by the body's radius so a small
     * moon and a large planet frame the same way.
     *
     * @param target — the body to sit on. Its position is read every frame, so
     *                 this keeps working while the body orbits.
     * @param radius — the body's radius in world units; sets the distance limits.
     */
    inspect(target: Transform, radius: number): void;

    /** The main Camera component (for reading FOV, aspect, etc.). */
    readonly camera: Camera;
}

/**
 * Configuration for camera rig creation.
 */
export interface CameraConfig {
    /** FOV for main camera. Default 60. */
    fieldOfView?: number;
    /** Near clip plane. Default 0.1. */
    nearClip?: number;
    /** Far clip plane. Default 500. */
    farClip?: number;
    /** Use skybox as background. Default true. */
    useSkybox?: boolean;
    /** Fallback background color when no skybox loaded. */
    backgroundColor?: Color;
    /** Orbit camera initial distance. Default 38. */
    orbitDistance?: number;
    /** Orbit camera max distance. Default 120. */
    orbitMaxDistance?: number;
    /** Fly camera starting position. Default (0, 10, 40). */
    flyStartPosition?: Vector3;
}

// ==================== FACTORY FUNCTION ====================

export function createCameraRig(config: CameraConfig = {}): ICameraRig {
    const fov        = config.fieldOfView ?? 60;
    const nearClip   = config.nearClip ?? 0.1;
    const farClip    = config.farClip ?? 500;
    const useSkybox  = config.useSkybox ?? true;
    const bgColor    = config.backgroundColor ?? new Color(0.01, 0.01, 0.03, 1);
    const orbitDist  = config.orbitDistance ?? 38;
    const orbitMax   = config.orbitMaxDistance ?? 120;
    const flyPos     = config.flyStartPosition ?? new Vector3(0, 10, 40);

    // ── Main Camera + Brain ──

    const camGo = new GameObject("Main Camera");
    camGo.tag = "MainCamera";

    const cam = camGo.addComponent(Camera);
    cam.fieldOfView = fov;
    cam.nearClipPlane = nearClip;
    cam.farClipPlane = farClip;
    cam.clearFlags = useSkybox ? CameraClearFlags.Skybox : CameraClearFlags.SolidColor;
    cam.backgroundColor = bgColor;

    const brain = camGo.addComponent(CinemachineBrain);
    brain.defaultBlendStyle = CinemachineBlendStyle.Cut;
    brain.defaultBlendTime = 0;

    // ── VCam 1: Orbit ──

    const orbitGo = new GameObject("VCam Orbit");
    const orbitVCam = orbitGo.addComponent(CinemachineVirtualCamera);
    orbitVCam.priority = 10;   // active by default
    orbitVCam.fieldOfView = fov;

    const orbBody = orbitGo.addComponent(CinemachineOrbitalBody);
    orbBody.orbitCenter = Vector3.zero;
    orbBody.distance = orbitDist;
    orbBody.minDistance = 3;
    orbBody.maxDistance = orbitMax;
    orbBody.orbitSpeed = 0.3;
    orbBody.zoomSpeed = 2;
    orbBody.panSpeed = 0.01;
    orbBody.damping = 6;

    orbitGo.addComponent(CinemachineOrbitalAim);

    // ── VCam 2: Fly (FPS) ──

    const flyGo = new GameObject("VCam Fly");
    flyGo.transform.position = flyPos;
    const flyVCam = flyGo.addComponent(CinemachineVirtualCamera);
    flyVCam.priority = 0;
    flyVCam.fieldOfView = 75;

    const flyBody = flyGo.addComponent(CinemachineFlyBody);
    flyBody.moveSpeed = 15;
    flyBody.fastMultiplier = 3;

    const flyAim = flyGo.addComponent(CinemachinePOVAim);
    flyAim.sensitivity = 0.15;

    // ── VCam 3: Follow ──

    const followGo = new GameObject("VCam Follow");
    const followVCam = followGo.addComponent(CinemachineVirtualCamera);
    followVCam.priority = 0;
    followVCam.fieldOfView = fov;

    const followBody = followGo.addComponent(CinemachineFollowBody);
    followBody.offset = new Vector3(0, 2, -5);
    followBody.damping = 4;

    followGo.addComponent(CinemachineHardLookAtAim);

    // ── VCam 4: Inspect ──
    //
    // An orbital body rather than a second follow: `CinemachineOrbitalBody`
    // already takes its centre from the vcam's follow target every frame, so
    // pointing it at a planet costs nothing and the drag/wheel controls come with
    // it. Distance is set per target in `inspect`, because framing the Sun and
    // framing the Moon at the same five units is what made the follow camera
    // useless for looking at anything.

    const inspectGo = new GameObject("VCam Inspect");
    const inspectVCam = inspectGo.addComponent(CinemachineVirtualCamera);
    inspectVCam.priority = 0;
    inspectVCam.fieldOfView = fov;

    const inspectBody = inspectGo.addComponent(CinemachineOrbitalBody);
    inspectBody.orbitSpeed = 0.3;
    inspectBody.zoomSpeed = 0.4;
    // Panning would slide the centre off the body it is meant to be holding.
    inspectBody.enablePan = false;
    inspectBody.damping = 6;

    inspectGo.addComponent(CinemachineOrbitalAim);

    // ── Build facade ──

    const all = [orbitVCam, flyVCam, followVCam, inspectVCam];
    /** Raises one virtual camera and lowers the rest; the list grows with the rig. */
    const solo = (active: CinemachineVirtualCamera): void => {
        for (const vcam of all) vcam.priority = vcam === active ? 10 : 0;
    };

    const rig: ICameraRig = {
        camera: cam,

        activateOrbit() {
            solo(orbitVCam);
            console.log("[Camera] → Orbit");
        },

        activateFly() {
            solo(flyVCam);
            console.log("[Camera] → Fly (click to lock cursor)");
        },

        activateFollow(target: Transform) {
            followVCam.follow = target;
            followVCam.lookAt = target;
            solo(followVCam);
            console.log("[Camera] → Follow");
        },

        inspect(target: Transform, radius: number) {
            inspectVCam.follow = target;
            inspectVCam.lookAt = target;

            // In radii, so every body is framed the same way whatever its size:
            // start far enough out to see the whole disc with room around it, and
            // let the wheel come in to nearly touching or back out to a wide shot.
            inspectBody.distance = radius * 4;
            inspectBody.minDistance = radius * 1.25;
            inspectBody.maxDistance = radius * 40;

            solo(inspectVCam);
        },
    };

    return rig;
}