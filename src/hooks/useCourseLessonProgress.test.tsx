import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCourseLessonProgress } from "./useCourseLessonProgress";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ rpc:vi.fn(), reward:vi.fn() }));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({user:{id:"viewer"}})}));
vi.mock("@/hooks/useRewardSystem",()=>({useRewardSystem:()=>({processReward:mocks.reward})}));
afterEach(()=>vi.resetAllMocks());
describe("recompensas de aulas de curso",()=>{
  it("usa o ID da aula, premia cada marco uma vez e separa o bônus do curso",async()=>{
    mocks.rpc.mockResolvedValue({data:{accepted_watched_delta:5,lesson_progress_percent:100,lesson_completed:true,course_completed:true},error:null});
    mocks.reward.mockResolvedValue({success:true});
    let hook:ReturnType<typeof useCourseLessonProgress>;
    const root=createRoot(document.createElement("div"));
    function Harness(){hook=useCourseLessonProgress({courseId:"course",lessonId:"lesson-a",duration:30});return null;}
    await act(async()=>root.render(<Harness/>));
    for(let i=1;i<=20;i++) await act(async()=>{hook.handleTimeUpdate(i);});
    const calls=mocks.reward.mock.calls.map(([call])=>[call.actionKey,call.contentId]);
    expect(calls.filter(([key])=>key==="VIEW_15S")).toEqual([["VIEW_15S","lesson-a"]]);
    expect(calls.filter(([key])=>key==="WATCH_50")).toEqual([["WATCH_50","lesson-a"]]);
    expect(calls.filter(([key])=>key==="WATCH_100")).toEqual([["WATCH_100","lesson-a"]]);
    expect(calls.filter(([key])=>key==="COMPLETE_COURSE")).toEqual([["COMPLETE_COURSE","course"]]);
    await act(async()=>root.unmount());
  });
  it("não transforma um salto no vídeo em progresso ou recompensa",async()=>{
    let hook:ReturnType<typeof useCourseLessonProgress>;
    const root=createRoot(document.createElement("div"));
    function Harness(){hook=useCourseLessonProgress({courseId:"course",lessonId:"lesson-a",duration:60});return null;}
    await act(async()=>root.render(<Harness/>));
    await act(async()=>{hook.handleTimeUpdate(59);await hook.completeLesson();});
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reward).not.toHaveBeenCalled();
    await act(async()=>root.unmount());
  });
});
