import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

export type ClassyReference = { type: "content" | "lesson" | "creator" | "study"; id: string; title: string };
export type ClassyLessonContext = ClassyReference & { path: string };
let current: ClassyLessonContext | null = null;
const eventName = "classfy:classy-lesson-context";
export function usePublishClassyLesson(id: string | undefined, title: string | undefined, accessible: boolean, type: "content" | "lesson" = "content") {
  const location = useLocation();
  useEffect(() => {
    const value = id && title && accessible ? { id, title, type, path: location.pathname } : null;
    current = value;
    window.dispatchEvent(new Event(eventName));
    return () => { if (current === value) { current = null; window.dispatchEvent(new Event(eventName)); } };
  }, [id, title, accessible, type, location.pathname]);
}
export function useClassyLesson() {
  const [lesson, setLesson] = useState(current);
  useEffect(() => { const update = () => setLesson(current); update(); window.addEventListener(eventName, update); return () => window.removeEventListener(eventName, update); }, []);
  return lesson;
}
