import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, XCircle, Trophy, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Question {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
}

interface StudyQuizProps {
  studyId: string;
  contentId: string;
  contentTitle: string;
}

export function StudyQuiz({ studyId, contentId, contentTitle }: StudyQuizProps) {
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
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-quiz", {
        body: { studyId, contentId }
      });

      if (error) throw error;
      
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
      toast.error(error.message || "Erro ao gerar quiz");
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
    if (selectedAnswer === null) return;

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
    const finalScore = selectedAnswer === currentQ.correctAnswer ? score + 1 : score;
    
    try {
      const { error } = await supabase
        .from("quiz_attempts")
        .insert({
          quiz_id: quiz.id,
          user_id: (await supabase.auth.getUser()).data.user?.id,
          answers: [...answers, selectedAnswer],
          score: finalScore,
          max_score: questions.length,
          time_spent_seconds: timeSpent
        });

      if (error) throw error;
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
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Quiz sobre: {contentTitle}</CardTitle>
          <CardDescription>
            Teste seus conhecimentos com um quiz gerado automaticamente pela Classy
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <Trophy className="w-16 h-16 text-primary" />
          <p className="text-center text-muted-foreground">
            Pronto para testar seu aprendizado? Classy vai gerar questões inteligentes baseadas no conteúdo!
          </p>
        </CardContent>
        <CardFooter>
          <Button 
            onClick={generateQuiz} 
            disabled={loading}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Gerando quiz...
              </>
            ) : (
              "Gerar Quiz"
            )}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (quizCompleted) {
    const finalScore = selectedAnswer === currentQ.correctAnswer ? score + 1 : score;
    const percentage = (finalScore / questions.length) * 100;

    return (
      <Card className="w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Trophy className="w-20 h-20 text-yellow-500" />
          </div>
          <CardTitle className="text-2xl">Quiz Concluído!</CardTitle>
          <CardDescription>{getScoreMessage()}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center">
            <div className="text-6xl font-bold text-primary mb-2">
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
              "Novo Quiz"
            )}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full">
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
          
          <RadioGroup value={selectedAnswer?.toString()} onValueChange={(v) => handleAnswerSelect(parseInt(v))}>
            {currentQ.options.map((option, idx) => {
              const isSelected = selectedAnswer === idx;
              const isCorrect = idx === currentQ.correctAnswer;
              const showCorrectAnswer = showResult && isCorrect;
              const showWrongAnswer = showResult && isSelected && !isCorrect;

              return (
                <div
                  key={idx}
                  className={cn(
                    "flex items-center space-x-3 p-4 rounded-lg border-2 transition-all cursor-pointer",
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
            "p-4 rounded-lg border-2",
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
            className="w-full"
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