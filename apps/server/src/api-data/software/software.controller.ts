import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'YOUR_SUPABASE_ANON_KEY';

const PLATFORM_MAP: Record<string, string> = {
  win32: 'download_url_windows',
  darwin: 'download_url_macos',
  linux: 'download_url_linux',
};

export async function getLatestVersion(req: Request, res: Response) {
  try {
    const platform = (req.query.platform as string) || process.platform;
    const downloadColumn = PLATFORM_MAP[platform];

    if (!downloadColumn) {
      res.status(400).json({
        error: 'Platform inválido. Use win32, darwin ou linux.',
      });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data, error } = await supabase
      .from('software_versions')
      .select('version, release_notes, download_url_windows, download_url_macos, download_url_linux')
      .eq('is_latest', true)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Software versions query error:', error);
      res.status(500).json({ error: 'Erro ao buscar versão mais recente.' });
      return;
    }

    if (!data) {
      res.status(404).json({ error: 'Nenhuma versão encontrada.' });
      return;
    }

    const downloadUrl = data[downloadColumn as keyof typeof data] as string | null;

    res.status(200).json({
      version: data.version,
      release_notes: data.release_notes || '',
      download_url: downloadUrl || null,
    });
  } catch (err) {
    console.error('getLatestVersion error:', err);
    res.status(500).json({ error: 'Erro ao verificar atualizações.' });
  }
}
