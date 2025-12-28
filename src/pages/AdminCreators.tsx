import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Clock, Loader2, AlertCircle } from "lucide-react";
import { GlobalLoader } from "@/components/GlobalLoader";

interface CreatorRequest {
  id: string;
  user_id: string;
  channel_name: string;
  bio: string | null;
  status: string;
  created_at: string;
  profiles: {
    display_name: string;
    avatar_url: string | null;
  };
}

export default function AdminCreators() {
  const { user, role, loading: authLoading } = useAuth();
  const [requests, setRequests] = useState<CreatorRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && role === 'admin') {
      fetchRequests();
    }
  }, [user, role]);

  const fetchRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('creator_requests')
        .select(`
          id,
          user_id,
          channel_name,
          bio,
          status,
          created_at,
          reviewed_at,
          reviewed_by,
          admin_notes
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch profiles separately to avoid relationship ambiguity
      const userIds = data?.map(r => r.user_id) || [];
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', userIds);

      // Merge data
      const mergedData = data?.map(request => ({
        ...request,
        profiles: profilesData?.find(p => p.id === request.user_id) || { display_name: '', avatar_url: null }
      })) || [];

      setRequests(mergedData as any);
    } catch (error: any) {
      setError(error.message);
      console.error('Error fetching requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (request: CreatorRequest) => {
    setProcessingId(request.id);
    setError(null);

    try {
      // Update creator request
      const { error: requestError } = await supabase
        .from('creator_requests')
        .update({ 
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id
        })
        .eq('id', request.id);

      if (requestError) throw requestError;

      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ creator_status: 'approved' })
        .eq('id', request.user_id);

      if (profileError) throw profileError;

      // Add creator role
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({ user_id: request.user_id, role: 'creator' });

      if (roleError && !roleError.message.includes('duplicate')) {
        throw roleError;
      }

      // Create notification for the user
      const { error: notificationError } = await supabase
        .from('notifications')
        .insert({
          user_id: request.user_id,
          type: 'creator_approved',
          title: '🎉 Parabéns! Você agora é Creator!',
          message: `Sua solicitação para o canal "${request.channel_name}" foi aprovada! Agora você pode enviar conteúdos e começar a ganhar com suas criações.`,
        });

      if (notificationError) {
        console.error('Error creating notification:', notificationError);
      }

      await fetchRequests();
    } catch (error: any) {
      setError(error.message);
      console.error('Error approving request:', error);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (request: CreatorRequest) => {
    setProcessingId(request.id);
    setError(null);

    try {
      // Update creator request
      const { error: requestError } = await supabase
        .from('creator_requests')
        .update({ 
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id
        })
        .eq('id', request.id);

      if (requestError) throw requestError;

      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ creator_status: 'rejected' })
        .eq('id', request.user_id);

      if (profileError) throw profileError;

      await fetchRequests();
    } catch (error: any) {
      setError(error.message);
      console.error('Error rejecting request:', error);
    } finally {
      setProcessingId(null);
    }
  };

  if (authLoading) {
    return <GlobalLoader />;
  }

  if (!user || role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-500"><Clock className="w-3 h-3 mr-1" />Pendente</Badge>;
      case 'approved':
        return <Badge className="bg-green-500/20 text-green-500"><CheckCircle className="w-3 h-3 mr-1" />Aprovado</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/20 text-red-500"><XCircle className="w-3 h-3 mr-1" />Rejeitado</Badge>;
      default:
        return null;
    }
  };

  return (
    <AdminLayout title="Creators">
      <div className="flex-1 p-6 md:p-12">
        <div className="max-w-5xl mx-auto space-y-6">
              {error && (
                <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                  <AlertCircle className="w-4 h-4" />
                  <span>{error}</span>
                </div>
              )}

              {loading ? (
                <div className="text-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">Carregando solicitações...</p>
                </div>
              ) : requests.length === 0 ? (
                <Card className="p-12 text-center bg-card border-border">
                  <CheckCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-bold text-foreground mb-2">
                    Nenhuma solicitação pendente
                  </h3>
                  <p className="text-muted-foreground">
                    Todas as solicitações de Creator foram processadas
                  </p>
                </Card>
              ) : (
                <div className="space-y-4">
                  {requests.map((request) => (
                    <Card key={request.id} className="p-6 bg-card border-border">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <h3 className="text-lg font-bold text-foreground">
                              {request.channel_name}
                            </h3>
                            {getStatusBadge(request.status)}
                          </div>
                          
                          <div className="space-y-2 text-sm">
                            <p className="text-muted-foreground">
                              <span className="font-medium text-foreground">Usuário:</span> {request.profiles.display_name}
                            </p>
                            {request.bio && (
                              <p className="text-muted-foreground">
                                <span className="font-medium text-foreground">Bio:</span> {request.bio}
                              </p>
                            )}
                            <p className="text-muted-foreground">
                              <span className="font-medium text-foreground">Solicitado em:</span>{' '}
                              {new Date(request.created_at).toLocaleDateString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </p>
                          </div>
                        </div>

                        {request.status === 'pending' && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReject(request)}
                              disabled={processingId === request.id}
                              className="text-destructive border-destructive/20 hover:bg-destructive/10"
                            >
                              {processingId === request.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <>
                                  <XCircle className="w-4 h-4 mr-1" />
                                  Rejeitar
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleApprove(request)}
                              disabled={processingId === request.id}
                              className="bg-green-600 hover:bg-green-700 text-white"
                            >
                              {processingId === request.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <>
                                  <CheckCircle className="w-4 h-4 mr-1" />
                                  Aprovar
                                </>
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
        </div>
      </div>
    </AdminLayout>
  );
}
