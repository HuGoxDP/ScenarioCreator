// scripts/helpers/FlatCamera.ts
// ============================================================
// A fixed orthographic camera looking at the bench plane.
//
// It sits on the engine's −Z side and looks along **+Z**, which is the engine's
// forward (Unity convention). An earlier version placed it at +Z and relied on
// Three's −Z-forward default: the camera then faced away from the bench and the
// scenario rendered its UI over an empty scene.
//
// NOT the Cinemachine rig the other scenarios copy, and the reason is physics
// rather than taste: under perspective, two rays that meet on screen need not
// meet in the plane, so a perspective camera can make a ray diagram lie about
// the one thing it exists to show. Orthographic, square to the plane, is the
// only projection in which "the rays cross here" is a fact about the optics.
//
// Pan and zoom only — there is no orbit, because there is nothing to see from
// another angle.
// ============================================================

import {
    GameObject, Camera, Vector3, Color, CameraClearFlags,
    Input, EventSystem,
} from "WebEngineTS";

export interface IFlatCamera {
    readonly camera: Camera;
    /** Called every frame by the scenario. */
    update(): void;
    reset(): void;
}

export interface FlatCameraConfig {
    /** Half the visible height, in world units. */
    size?: number;
    minSize?: number;
    maxSize?: number;
    background?: Color;
}

export function createFlatCamera(config: FlatCameraConfig = {}): IFlatCamera {
    const startSize = config.size ?? 14;
    const minSize = config.minSize ?? 5;
    const maxSize = config.maxSize ?? 30;

    const go = new GameObject("Main Camera");
    go.tag = "MainCamera";
    go.transform.position = new Vector3(0, 0, -20);

    const camera = go.addComponent(Camera);
    camera.orthographic = true;
    camera.orthographicSize = startSize;
    camera.nearClipPlane = 0.1;
    camera.farClipPlane = 100;
    camera.clearFlags = CameraClearFlags.SolidColor;
    camera.backgroundColor = config.background ?? new Color(0.05, 0.06, 0.09, 1);

    return {
        camera,

        update(): void {
            const scroll = Input.mouseScrollDelta.y;
            if (scroll !== 0 && !EventSystem.isPointerOverUI) {
                const next = camera.orthographicSize * (1 - scroll * 0.08);
                camera.orthographicSize = Math.min(Math.max(next, minSize), maxSize);
            }

            if (Input.getMouseButton(0) && !EventSystem.isPointerOverUI) {
                // Drag moves the view with the pointer, so the content appears
                // to be grabbed rather than pushed.
                const delta = Input.mouseDelta;
                const perPixel = camera.orthographicSize * 0.0028;
                const at = go.transform.position;
                go.transform.position = new Vector3(
                    at.x - delta.x * perPixel,
                    at.y + delta.y * perPixel,
                    at.z,
                );
            }
        },

        reset(): void {
            go.transform.position = new Vector3(0, 0, -20);
            camera.orthographicSize = startSize;
        },
    };
}
