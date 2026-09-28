import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, XCircle, Trophy, RotateCcw, Brain } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { registerDifficulty } from "@/lib/personalization/interests";

interface Question {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
}

interface StudyQuizProps {
  studyId?: string | null;
  contentId: string;
  contentTitle: string;
}

export function StudyQuiz({ studyId, contentId, contentTitle }: StudyQuizProps) {
  const { user } = useAuth();
  const viewerId = user?.id;
  const [selectedStudyId, setSelectedStudyId] = useState(studyId || "");
  const [studies, setStudies] = useState<Array<{ id: string; title: string }>>([]);
  const [studiesLoading, setStudiesLoading] = useState(!studyId);
  const [errorMessage, setErrorMessage] = useState("");
  useEffect(() => {
    setSelectedStudyId(studyId || "");
    setQuiz(null);
    if (studyId || !viewerId) { setStudiesLoading(false); return; }
    let cancelled = false;
    setStudiesLoading(true);
    supabase.from("studies").select("id, title").eq("user_id", viewerId).eq("status", "active")
      .order("last_activity_at", { ascending: false }).then(({ data, error }) => {
        if (cancelled) return;
        setStudies(data || []);
        setStudiesLoading(false);
        if (error) setErrorMessage("Não foi possível carregar seus estudos. Feche e tente novamente.");
      });
    return () => { cancelled = true; };
  }, [studyId, contentId, viewerId]);
  const [quiz, setQuiz] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [score, setScore] = useState(0);
  const [startTime, setStartTime] = useState<Date | null>(null);

  const generateQuiz = async () => {
    if (!selectedStudyId || !user || loading) return;
    setLoading(true);
    setErrorMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("generate-quiz", {
        body: { studyId: selectedStudyId, contentId }
      });

      if (error) {
        console.error("Edge function error:", error);
        const payload = error.context instanceof Response ? await error.context.json().catch(() => null) : null;
        throw new Error(payload?.error || error.message || "Erro ao gerar quiz");
      }

      if (data?.error) {
        throw new Error(data.error);
      }
      
      if (!data?.id || !Array.isArray(data.questions) || data.questions.length === 0 || data.questions.some((q: Question) => !Array.isArray(q.options) || !Number.isInteger(q.correctAnswer) || q.correctAnswer < 0 || q.correctAnswer >= q.options.length)) {
        throw new Error("Quiz não foi gerado corretamente");
      }

      setQuiz(data);
      setStartTime(new Date());
      setCurrentQuestion(0);
      setAnswers([]);
      setSelectedAnswer(null);
      setShowResult(false);
      setQuizCompleted(false);
      setScore(0);
      toast.success("Quiz gerado com sucesso!");
    } catch (error: any) {
      console.error("Error generating quiz:", error);
      
      let errorMessage = "Erro ao gerar quiz";
      if (error.message?.includes("Transcrição não disponível")) {
        errorMessage = "Este conteúdo ainda não possui transcrição. Por favor, aguarde o processamento ou selecione outro conteúdo.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setErrorMessage(errorMessage);
      toast.error(errorMessage, { duration: 5000 });
    } finally {
      setLoading(false);
    }
  };

  const questions: Question[] = quiz?.questions || [];
  const currentQ = questions[currentQuestion];
  const isLastQuestion = currentQuestion === questions.length - 1;

  const handleAnswerSelect = (answerIndex: number) => {
    if (showResult) return;
    setSelectedAnswer(answerIndex);
  };

  const handleSubmitAnswer = () => {
    if (selectedAnswer === null || showResult) return;

    const newAnswers = [...answers, selectedAnswer];
    setAnswers(newAnswers);
    setShowResult(true);

    if (selectedAnswer === currentQ.correctAnswer) {
      setScore(score + 1);
    }
  };

  const handleNextQuestion = () => {
    if (isLastQuestion) {
      completeQuiz();
    } else {
      setCurrentQuestion(currentQuestion + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    }
  };

  const completeQuiz = async () => {
    setQuizCompleted(true);
    
    const timeSpent = startTime ? Math.floor((Date.now() - startTime.getTime()) / 1000) : 0;
    const finalScore = score;
    
    try {
      const { error } = await supabase
        .from("quiz_attempts")
        .insert({
          quiz_id: quiz.id,
          user_id: user?.id,
          answers,
          score: finalScore,
          max_score: questions.length,
          time_spent_seconds: timeSpent
        });

      if (error) throw error;

      const percentage = questions.length > 0 ? (finalScore / questions.length) * 100 : 0;
      if (percentage < 60) {
        const missedTopics = questions
          .filter((question, index) => answers[index] !== question.correctAnswer)
          .map((question) => question.question)
          .slice(0, 3)
          .join(" | ");

        await registerDifficulty({
          userId: user?.id,
          topic: contentTitle,
          detail: missedTopics || `Quiz com ${percentage.toFixed(0)}% de acertos`,
        });
      }
    } catch (error) {
      console.error("Error saving quiz attempt:", error);
    }
  };

  const restartQuiz = () => {
    setCurrentQuestion(0);
    setAnswers([]);
    setSelectedAnswer(null);
    setShowResult(false);
    setQuizCompleted(false);
    setScore(0);
    setStartTime(new Date());
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case "easy": return "bg-green-500";
      case "medium": return "bg-yellow-500";
      case "hard": return "bg-red-500";
      default: return "bg-gray-500";
    }
  };

  const getScoreMessage = () => {
    const percentage = (score / questions.length) * 100;
    if (percentage >= 80) return "🎉 Excelente! Você domina o conteúdo!";
    if (percentage >= 60) return "👍 Bom trabalho! Continue estudando.";
    if (percentage >= 40) return "📚 Revise o conteúdo e tente novamente.";
    return "💪 Não desista! Assista o conteúdo novamente.";
  };

  if (!quiz) {
    return (
      <Card className="cf-study-quiz w-full">
        <CardHeader className="pb-4">
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10"><Brain className="h-5 w-5 text-red-500" aria-hidden="true" /></div>
          <CardTitle className="text-xl tracking-tight">Teste seu aprendizado</CardTitle>
          <CardDescription className="text-sm leading-relaxed">Responda às perguntas e descubra o que vale revisar.</CardDescription>
          <p className="pt-2 text-xs text-muted-foreground line-clamp-2">{contentTitle}</p>
        </CardHeader>
        <CardContent className="space-y-4 pb-5">
          {!studyId && <div className="space-y-2">
            <Label htmlFor="quiz-study" className="text-sm">Salvar quiz no estudo</Label>
            <select id="quiz-study" value={selectedStudyId} onChange={(event) => setSelectedStudyId(event.target.value)} disabled={studiesLoading}
              className="min-h-12 w-full rounded-xl border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30">
              <option value="">{studiesLoading ? "Carregando estudos..." : "Selecione um estudo"}</option>
              {studies.map((study) => <option key={study.id} value={study.id}>{study.title}</option>)}
            </select>
            <p className="text-xs leading-relaxed text-muted-foreground">{!studiesLoading && studies.length === 0 ? "Use o botão Estudo da aula para criar seu primeiro estudo." : "Seu resultado fica guardado neste estudo."}</p>
          </div>}
          {errorMessage && <p role="alert" className="rounded-xl bg-destructive/5 p-3 text-sm text-destructive">{errorMessage}</p>}
        </CardContent>
        <CardFooter>
          <Button onClick={generateQuiz} disabled={loading || !selectedStudyId || !user || studiesLoading} className="h-12 w-full rounded-xl bg-red-500 text-white hover:bg-red-600">
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Preparando quiz...</> : "Gerar Quiz"}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (quizCompleted) {
    const finalScore = score;
    const percentage = (finalScore / questions.length) * 100;

    return (
      <Card className="cf-study-quiz w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Trophy className="w-12 h-12 text-red-500" />
          </div>
          <CardTitle className="text-2xl">Quiz Concluído!</CardTitle>
          <CardDescription>{getScoreMessage()}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center">
            <div className="text-5xl font-bold tracking-tight text-foreground mb-4">
              {finalScore}/{questions.length}
            </div>
            <Progress value={percentage} className="h-3" />
            <p className="text-sm text-muted-foreground mt-2">
              {percentage.toFixed(0)}% de acertos
            </p>
          </div>
          
          <div className="space-y-2">
            <h3 className="font-semibold">Resumo do desempenho:</h3>
            {questions.map((q, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                {answers[idx] === q.correctAnswer ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500" />
                )}
                <span>Questão {idx + 1}</span>
                <Badge className={getDifficultyColor(q.difficulty)} variant="secondary">
                  {q.difficulty}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button onClick={restartQuiz} variant="outline" className="flex-1">
            <RotateCcw className="w-4 h-4 mr-2" />
            Refazer Quiz
          </Button>
          <Button onClick={generateQuiz} className="flex-1" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Gerando...
              </>
            ) : (
              "Abrir Quiz"
            )}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="cf-study-quiz w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Questão {currentQuestion + 1} de {questions.length}</CardTitle>
            <CardDescription>{contentTitle}</CardDescription>
          </div>
          <Badge className={getDifficultyColor(currentQ.difficulty)} variant="secondary">
            {currentQ.difficulty}
          </Badge>
        </div>
        <Progress value={((currentQuestion + 1) / questions.length) * 100} className="mt-2" />
      </CardHeader>
      
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold leading-relaxed">{currentQ.question}</h3>
          
          <RadioGroup value={selectedAnswer?.toString() ?? ""} onValueChange={(v) => handleAnswerSelect(parseInt(v))}>
            {currentQ.options.map((option, idx) => {
              const isSelected = selectedAnswer === idx;
              const isCorrect = idx === currentQ.correctAnswer;
              const showCorrectAnswer = showResult && isCorrect;
              const showWrongAnswer = showResult && isSelected && !isCorrect;

              return (
                <div
                  key={idx}
                  className={cn(
                    "flex items-center space-x-3 p-3.5 rounded-xl border transition-all cursor-pointer",
                    isSelected && !showResult && "border-primary bg-primary/5",
                    showCorrectAnswer && "border-green-500 bg-green-500/10",
                    showWrongAnswer && "border-red-500 bg-red-500/10",
                    !isSelected && !showResult && "border-border hover:border-primary/50"
                  )}
                  onClick={() => !showResult && handleAnswerSelect(idx)}
                >
                  <RadioGroupItem value={idx.toString()} id={`option-${idx}`} disabled={showResult} />
                  <Label htmlFor={`option-${idx}`} className="flex-1 cursor-pointer">
                    <div className="flex items-center justify-between">
                      <span>{option}</span>
                      {showCorrectAnswer && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                      {showWrongAnswer && <XCircle className="w-5 h-5 text-red-500" />}
                    </div>
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        </div>

        {showResult && (
          <div className={cn(
            "p-3.5 rounded-xl border",
            selectedAnswer === currentQ.correctAnswer 
              ? "border-green-500 bg-green-500/10" 
              : "border-red-500 bg-red-500/10"
          )}>
            <div className="flex items-start gap-3">
              {selectedAnswer === currentQ.correctAnswer ? (
                <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className="font-semibold mb-2">
                  {selectedAnswer === currentQ.correctAnswer ? "Correto!" : "Incorreto!"}
                </p>
                <p className="text-sm leading-relaxed">{currentQ.explanation}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter>
        {!showResult ? (
          <Button 
            onClick={handleSubmitAnswer} 
            disabled={selectedAnswer === null}
            className="h-12 w-full rounded-xl"
          >
            Confirmar Resposta
          </Button>
        ) : (
          <Button onClick={handleNextQuestion} className="w-full">
            {isLastQuestion ? "Ver Resultado" : "Próxima Questão"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
