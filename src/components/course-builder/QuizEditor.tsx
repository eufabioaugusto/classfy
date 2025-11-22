import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, Check, X, GripVertical, Library } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";

type QuestionType = "multiple" | "true-false" | "essay" | "fill-blank";

interface QuizQuestion {
  id: string;
  question: string;
  type: QuestionType;
  options: string[];
  correctAnswer: number | string;
  explanation: string;
  points: number;
}

interface Quiz {
  id: string;
  title: string;
  description: string;
  questions: QuizQuestion[];
  passingScore: number;
  maxAttempts: number;
}

interface QuizEditorProps {
  quiz: Quiz;
  onUpdate: (quiz: Quiz) => void;
  onClose: () => void;
}

function DraggableQuestion({ 
  id, 
  children 
}: { 
  id: string; 
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${isDragging ? "opacity-50 z-50" : ""}`}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute left-2 top-4 cursor-grab active:cursor-grabbing z-10 p-1 hover:bg-accent rounded transition-colors"
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="pl-8">{children}</div>
    </div>
  );
}

export function QuizEditor({ quiz, onUpdate, onClose }: QuizEditorProps) {
  const [editingQuiz, setEditingQuiz] = useState<Quiz>(quiz);
  const [showQuestionBank, setShowQuestionBank] = useState(false);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);
  
  // Simulated question bank - in production, this would come from a database
  const [questionBank] = useState<QuizQuestion[]>([
    {
      id: "bank-1",
      question: "O que é React?",
      type: "multiple",
      options: ["Uma biblioteca JavaScript", "Uma linguagem de programação", "Um framework CSS", "Um banco de dados"],
      correctAnswer: 0,
      explanation: "React é uma biblioteca JavaScript para construir interfaces de usuário.",
      points: 10,
    },
    {
      id: "bank-2",
      question: "React é mantido pelo Facebook.",
      type: "true-false",
      options: ["Verdadeiro", "Falso"],
      correctAnswer: 0,
      explanation: "React foi criado e é mantido pelo Facebook (Meta).",
      points: 5,
    },
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const addQuestion = (type: QuestionType = "multiple") => {
    const newQuestion: QuizQuestion = {
      id: crypto.randomUUID(),
      question: "",
      type,
      options: type === "multiple" ? ["", "", "", ""] : type === "true-false" ? ["Verdadeiro", "Falso"] : [],
      correctAnswer: type === "essay" ? "" : 0,
      explanation: "",
      points: 10,
    };

    setEditingQuiz({
      ...editingQuiz,
      questions: [...editingQuiz.questions, newQuestion],
    });
    setEditingQuestionIndex(editingQuiz.questions.length);
  };

  const removeQuestion = (index: number) => {
    setEditingQuiz({
      ...editingQuiz,
      questions: editingQuiz.questions.filter((_, i) => i !== index),
    });
    if (editingQuestionIndex === index) {
      setEditingQuestionIndex(null);
    }
  };

  const updateQuestion = (index: number, field: keyof QuizQuestion, value: any) => {
    const updatedQuestions = [...editingQuiz.questions];
    updatedQuestions[index] = {
      ...updatedQuestions[index],
      [field]: value,
    };
    setEditingQuiz({
      ...editingQuiz,
      questions: updatedQuestions,
    });
  };

  const addQuestionFromBank = (question: QuizQuestion) => {
    const newQuestion = {
      ...question,
      id: crypto.randomUUID(), // Generate new ID
    };
    setEditingQuiz({
      ...editingQuiz,
      questions: [...editingQuiz.questions, newQuestion],
    });
    toast.success("Questão adicionada do banco!");
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = editingQuiz.questions.findIndex((q) => q.id === active.id);
      const newIndex = editingQuiz.questions.findIndex((q) => q.id === over.id);
      
      setEditingQuiz({
        ...editingQuiz,
        questions: arrayMove(editingQuiz.questions, oldIndex, newIndex),
      });
      toast.success("Questão reordenada!");
    }
  };

  const handleSave = () => {
    if (!editingQuiz.title) {
      toast.error("Digite um título para o quiz");
      return;
    }

    if (editingQuiz.questions.length === 0) {
      toast.error("Adicione pelo menos uma questão");
      return;
    }

    const hasEmptyQuestions = editingQuiz.questions.some(q => !q.question);
    if (hasEmptyQuestions) {
      toast.error("Todas as questões precisam ter uma pergunta");
      return;
    }

    onUpdate(editingQuiz);
    toast.success("Quiz salvo com sucesso!");
    onClose();
  };

  const getQuestionTypeLabel = (type: QuestionType) => {
    const labels = {
      multiple: "Múltipla Escolha",
      "true-false": "Verdadeiro/Falso",
      essay: "Dissertativa",
      "fill-blank": "Preencher Lacunas",
    };
    return labels[type];
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Editor de Quiz</DialogTitle>
          <DialogDescription>
            Crie questões e configure o quiz para avaliar os alunos
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="editor" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="preview">Prévia</TabsTrigger>
          </TabsList>

          <TabsContent value="editor" className="space-y-4">
            <ScrollArea className="h-[60vh]">
              <div className="space-y-4 pr-4">
                {/* Quiz Info */}
                <Card className="p-4 space-y-3">
                  <div>
                    <Label htmlFor="quiz-title">Título do Quiz *</Label>
                    <Input
                      id="quiz-title"
                      value={editingQuiz.title}
                      onChange={(e) => setEditingQuiz({ ...editingQuiz, title: e.target.value })}
                      placeholder="Ex: Avaliação do Módulo 1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="quiz-description">Descrição</Label>
                    <Textarea
                      id="quiz-description"
                      value={editingQuiz.description}
                      onChange={(e) => setEditingQuiz({ ...editingQuiz, description: e.target.value })}
                      placeholder="Breve descrição sobre o quiz..."
                      rows={2}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="passing-score">Nota de Aprovação (%)</Label>
                      <Input
                        id="passing-score"
                        type="number"
                        min="0"
                        max="100"
                        value={editingQuiz.passingScore}
                        onChange={(e) => setEditingQuiz({ ...editingQuiz, passingScore: parseInt(e.target.value) || 70 })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="max-attempts">Tentativas Máximas</Label>
                      <Input
                        id="max-attempts"
                        type="number"
                        min="1"
                        max="10"
                        value={editingQuiz.maxAttempts}
                        onChange={(e) => setEditingQuiz({ ...editingQuiz, maxAttempts: parseInt(e.target.value) || 3 })}
                      />
                    </div>
                  </div>
                </Card>

                {/* Questions */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-base">Questões ({editingQuiz.questions.length})</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowQuestionBank(true)}
                      >
                        <Library className="w-4 h-4 mr-2" />
                        Banco de Questões
                      </Button>
                      <Select onValueChange={(value) => addQuestion(value as QuestionType)}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Nova questão" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="multiple">Múltipla Escolha</SelectItem>
                          <SelectItem value="true-false">Verdadeiro/Falso</SelectItem>
                          <SelectItem value="essay">Dissertativa</SelectItem>
                          <SelectItem value="fill-blank">Preencher Lacunas</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {editingQuiz.questions.length === 0 ? (
                    <Card className="p-8 text-center">
                      <p className="text-muted-foreground mb-4">Nenhuma questão adicionada ainda</p>
                      <Button type="button" onClick={() => addQuestion()}>
                        <Plus className="w-4 h-4 mr-2" />
                        Adicionar Primeira Questão
                      </Button>
                    </Card>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={editingQuiz.questions.map(q => q.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-3">
                          {editingQuiz.questions.map((question, index) => (
                            <DraggableQuestion key={question.id} id={question.id}>
                              <Card className="p-4">
                                <div className="space-y-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 space-y-3">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-primary">Q{index + 1}</span>
                                        <span className="text-xs px-2 py-1 bg-muted rounded-full">
                                          {getQuestionTypeLabel(question.type)}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {question.points} pontos
                                        </span>
                                      </div>

                                      <div>
                                        <Label htmlFor={`question-${index}`}>Pergunta *</Label>
                                        <Textarea
                                          id={`question-${index}`}
                                          value={question.question}
                                          onChange={(e) => updateQuestion(index, 'question', e.target.value)}
                                          placeholder="Digite a pergunta..."
                                          rows={2}
                                        />
                                      </div>

                                      {/* Multiple Choice Options */}
                                      {question.type === "multiple" && (
                                        <div className="space-y-2">
                                          <Label>Opções de Resposta</Label>
                                          {question.options.map((option, optionIndex) => (
                                            <div key={optionIndex} className="flex items-center gap-2">
                                              <input
                                                type="radio"
                                                name={`correct-${index}`}
                                                checked={question.correctAnswer === optionIndex}
                                                onChange={() => updateQuestion(index, 'correctAnswer', optionIndex)}
                                                className="cursor-pointer"
                                              />
                                              <Input
                                                value={option}
                                                onChange={(e) => {
                                                  const newOptions = [...question.options];
                                                  newOptions[optionIndex] = e.target.value;
                                                  updateQuestion(index, 'options', newOptions);
                                                }}
                                                placeholder={`Opção ${optionIndex + 1}`}
                                              />
                                            </div>
                                          ))}
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                              const newOptions = [...question.options, ""];
                                              updateQuestion(index, 'options', newOptions);
                                            }}
                                          >
                                            <Plus className="w-4 h-4 mr-2" />
                                            Adicionar Opção
                                          </Button>
                                        </div>
                                      )}

                                      {/* True/False Options */}
                                      {question.type === "true-false" && (
                                        <div className="space-y-2">
                                          <Label>Resposta Correta</Label>
                                          <div className="flex gap-4">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                              <input
                                                type="radio"
                                                name={`correct-${index}`}
                                                checked={question.correctAnswer === 0}
                                                onChange={() => updateQuestion(index, 'correctAnswer', 0)}
                                              />
                                              <span className="text-sm">Verdadeiro</span>
                                            </label>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                              <input
                                                type="radio"
                                                name={`correct-${index}`}
                                                checked={question.correctAnswer === 1}
                                                onChange={() => updateQuestion(index, 'correctAnswer', 1)}
                                              />
                                              <span className="text-sm">Falso</span>
                                            </label>
                                          </div>
                                        </div>
                                      )}

                                      {/* Essay Question */}
                                      {question.type === "essay" && (
                                        <div className="p-3 bg-muted/50 rounded-lg">
                                          <p className="text-sm text-muted-foreground">
                                            💡 Questão dissertativa - O aluno responderá com texto livre. A correção será manual.
                                          </p>
                                        </div>
                                      )}

                                      {/* Fill in the Blanks */}
                                      {question.type === "fill-blank" && (
                                        <div className="space-y-2">
                                          <Label>Resposta Esperada</Label>
                                          <Input
                                            value={question.correctAnswer as string}
                                            onChange={(e) => updateQuestion(index, 'correctAnswer', e.target.value)}
                                            placeholder="Digite a resposta correta..."
                                          />
                                          <p className="text-xs text-muted-foreground">
                                            Dica: Use ___ na pergunta para indicar onde o aluno deve preencher
                                          </p>
                                        </div>
                                      )}

                                      <div>
                                        <Label htmlFor={`explanation-${index}`}>Explicação (Opcional)</Label>
                                        <Textarea
                                          id={`explanation-${index}`}
                                          value={question.explanation}
                                          onChange={(e) => updateQuestion(index, 'explanation', e.target.value)}
                                          placeholder="Explique a resposta correta..."
                                          rows={2}
                                        />
                                      </div>

                                      <div className="w-32">
                                        <Label htmlFor={`points-${index}`}>Pontos</Label>
                                        <Input
                                          id={`points-${index}`}
                                          type="number"
                                          min="1"
                                          value={question.points}
                                          onChange={(e) => updateQuestion(index, 'points', parseInt(e.target.value) || 10)}
                                        />
                                      </div>
                                    </div>

                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => removeQuestion(index)}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              </Card>
                            </DraggableQuestion>
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="preview" className="space-y-4">
            <ScrollArea className="h-[60vh]">
              <div className="space-y-4 pr-4">
                <Card className="p-6">
                  <h3 className="text-xl font-bold mb-2">{editingQuiz.title || "Título do Quiz"}</h3>
                  {editingQuiz.description && (
                    <p className="text-muted-foreground mb-4">{editingQuiz.description}</p>
                  )}
                  <div className="flex gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Questões:</span>
                      <span className="font-semibold">{editingQuiz.questions.length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Nota de Aprovação:</span>
                      <span className="font-semibold">{editingQuiz.passingScore}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Tentativas:</span>
                      <span className="font-semibold">{editingQuiz.maxAttempts}</span>
                    </div>
                  </div>
                </Card>

                {editingQuiz.questions.map((question, index) => (
                  <Card key={question.id} className="p-6">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between">
                        <h4 className="font-semibold text-lg">
                          Questão {index + 1}
                        </h4>
                        <span className="text-sm text-muted-foreground">{question.points} pts</span>
                      </div>
                      
                      <p className="text-foreground">{question.question || "Pergunta não definida"}</p>

                      {question.type === "multiple" && (
                        <div className="space-y-2">
                          {question.options.map((option, optionIndex) => (
                            <div
                              key={optionIndex}
                              className={`p-3 rounded-lg border ${
                                question.correctAnswer === optionIndex
                                  ? "border-green-500 bg-green-500/10"
                                  : "border-border"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                {question.correctAnswer === optionIndex && (
                                  <Check className="w-4 h-4 text-green-500" />
                                )}
                                <span>{option || `Opção ${optionIndex + 1}`}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {question.type === "true-false" && (
                        <div className="flex gap-3">
                          <div
                            className={`flex-1 p-3 rounded-lg border text-center ${
                              question.correctAnswer === 0
                                ? "border-green-500 bg-green-500/10"
                                : "border-border"
                            }`}
                          >
                            Verdadeiro
                          </div>
                          <div
                            className={`flex-1 p-3 rounded-lg border text-center ${
                              question.correctAnswer === 1
                                ? "border-green-500 bg-green-500/10"
                                : "border-border"
                            }`}
                          >
                            Falso
                          </div>
                        </div>
                      )}

                      {question.type === "essay" && (
                        <div className="p-4 bg-muted/50 rounded-lg border border-dashed">
                          <p className="text-sm text-muted-foreground italic">
                            [Resposta dissertativa do aluno]
                          </p>
                        </div>
                      )}

                      {question.type === "fill-blank" && (
                        <div className="p-3 bg-muted rounded-lg">
                          <Input
                            placeholder="Digite sua resposta..."
                            disabled
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            Resposta esperada: {question.correctAnswer as string}
                          </p>
                        </div>
                      )}

                      {question.explanation && (
                        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                          <p className="text-sm font-semibold mb-1">Explicação:</p>
                          <p className="text-sm">{question.explanation}</p>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between pt-4 border-t">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave}>
            Salvar Quiz
          </Button>
        </div>

        {/* Question Bank Modal */}
        <Dialog open={showQuestionBank} onOpenChange={setShowQuestionBank}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Banco de Questões</DialogTitle>
              <DialogDescription>
                Selecione questões prontas para adicionar ao seu quiz
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="h-[400px]">
              <div className="space-y-3 pr-4">
                {questionBank.map((question) => (
                  <Card key={question.id} className="p-4 hover:border-primary transition-colors">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs px-2 py-1 bg-muted rounded-full">
                              {getQuestionTypeLabel(question.type)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {question.points} pontos
                            </span>
                          </div>
                          <p className="font-medium">{question.question}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => addQuestionFromBank(question)}
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Adicionar
                        </Button>
                      </div>

                      {question.type === "multiple" && (
                        <div className="ml-4 space-y-1">
                          {question.options.map((option, idx) => (
                            <div key={idx} className="text-sm flex items-center gap-2">
                              {question.correctAnswer === idx ? (
                                <Check className="w-3 h-3 text-green-500" />
                              ) : (
                                <X className="w-3 h-3 text-muted-foreground" />
                              )}
                              <span className={question.correctAnswer === idx ? "text-green-600 dark:text-green-400" : ""}>
                                {option}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                ))}

                {questionBank.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Library className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p>Nenhuma questão no banco ainda</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}