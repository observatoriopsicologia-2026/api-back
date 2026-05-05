insert into researchers (name, institution, country, specialty, bio, email, profile_url, is_featured)
values
  (
    'Ana María Torres',
    'Universidad Católica de Colombia',
    'Colombia',
    'Clima organizacional y bienestar laboral',
    'Investigadora en psicología del trabajo con énfasis en bienestar, liderazgo y cultura organizacional.',
    'ana.torres@example.edu.co',
    '',
    true
  ),
  (
    'Luis Fernando Méndez',
    'Universidad de São Paulo',
    'Brasil',
    'Transformación digital y trabajo híbrido',
    'Profesor e investigador en procesos de cambio, tecnología y gestión humana.',
    'luis.mendez@example.edu.br',
    '',
    true
  ),
  (
    'Carolina Vidal',
    'Universidad Autónoma de Madrid',
    'España',
    'Evaluación psicológica organizacional',
    'Consultora académica en medición de clima, engagement y riesgos psicosociales.',
    'carolina.vidal@example.es',
    '',
    true
  )
on conflict do nothing;

insert into events (title, description, starts_at, location, modality, category, url, is_featured)
values
  (
    'VII Congreso Iberoamericano de Psicología Organizacional',
    'Encuentro académico con investigadores de la región.',
    '2026-10-14 09:00:00-05',
    'Madrid, España',
    'Presencial',
    'Congreso',
    '',
    true
  ),
  (
    'Webinar: nuevas metodologías en evaluación del clima laboral',
    'Sesión virtual para equipos de investigación y consultoría.',
    '2026-08-21 11:00:00-05',
    'Online',
    'Virtual',
    'Webinar',
    '',
    true
  ),
  (
    'Seminario de liderazgo y gestión del cambio',
    'Miradas actuales para organizaciones latinoamericanas.',
    '2026-11-04 10:00:00-05',
    'Buenos Aires, Argentina',
    'Híbrido',
    'Seminario',
    '',
    true
  )
on conflict do nothing;

insert into news (title, summary, body, image_url, source_url, published_at, is_featured)
values
  (
    'Nueva red de investigadores en POT presenta resultados de estudio transnacional',
    'La red iberoamericana comparte hallazgos sobre clima, liderazgo y bienestar laboral.',
    'El observatorio consolida nuevas líneas de análisis comparado entre universidades aliadas.',
    '',
    '',
    '2026-04-01',
    true
  ),
  (
    'Abierta la convocatoria para proyectos colaborativos 2026',
    'Investigadores de universidades aliadas podrán postular iniciativas regionales.',
    'La convocatoria prioriza proyectos con datos abiertos, cooperación internacional y transferencia social.',
    '',
    '',
    '2026-03-22',
    true
  )
on conflict do nothing;

insert into resources (title, description, type, url, tags, is_featured)
values
  (
    'Repositorio de instrumentos POT',
    'Colección inicial de escalas, cuestionarios y guías metodológicas para investigación.',
    'Repositorio',
    '',
    array['instrumentos', 'metodología', 'investigación'],
    true
  ),
  (
    'Guía para publicar en el Observatorio',
    'Criterios de calidad, metadatos sugeridos y recomendaciones para cargar documentos.',
    'Guía',
    '',
    array['publicaciones', 'pdf', 'admin'],
    true
  )
on conflict do nothing;

