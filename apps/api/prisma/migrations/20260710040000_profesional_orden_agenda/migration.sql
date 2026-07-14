-- Orden manual de la columna en la agenda. null = orden normal (alfabético).
-- Un valor mayor empuja la columna hacia la DERECHA (después de las normales y
-- de las "Adicional"). Pedido: Wenceslao Castillo al final del todo.
ALTER TABLE "profesionales" ADD COLUMN "ordenAgenda" INTEGER;
