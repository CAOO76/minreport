import { useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { M3Button } from './M3Button';
import { useBrandConfig } from '../hooks/useBrandConfig';


interface PDFExportButtonProps {
  makeModel: string;
  reporteId: string;
  titulo: string;
  sintesis: string;
  dimension: string;
  fileName: string;
  visual_format?: string;
  extractedData?: Record<string, unknown>[];
  classified_sources?: Record<string, Array<{ dato_aportado: string; url_limpia: string }>>;
}

export default function PDFExportButton({ 
  makeModel, titulo, sintesis, dimension, fileName, extractedData, visual_format, classified_sources
}: PDFExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const { brand } = useBrandConfig();


  // Filtro de integridad industrial: elimina filas que solo contienen caracteres de relleno
  const isFillerOnly = (text: string) => {
    const alphanumeric = text.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]/g, '');
    return alphanumeric.length < 2 && (text.includes('..') || text.includes('--') || text.includes('__'));
  };

  const cleanMarkdown = (text: string) => {
    return text
      .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
      .replace(/(\*|_)(.*?)\1/g, '$2')   // italic
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1') // remove links but keep text
      .replace(/`([^`]+)`/g, '$1') // code
      .replace(/^- /gm, '• ') // list items
      .trim();
  };

  const getBase64ImageFromUrl = async (imageUrl: string): Promise<string> => {
    const res = await fetch(imageUrl);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result as string), false);
      reader.onerror = () => reject(new Error("Failed to convert image to base64"));
      reader.readAsDataURL(blob);
    });
  };

  /**
   * DETERMINISMO INDUSTRIAL (Sincronizado con Vault UI)
   */
  const generatePDF = async () => {

    setLoading(true);
    try {
      const sintesisLines = sintesis.split('\n');

      const isRedundant = (text: string) => {
        const normalizedText = text.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const normalizedTitle = titulo.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const normalizedMakeModel = makeModel.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        
        if (normalizedText.length < 5) return false;
        if (normalizedTitle.includes(normalizedText) || normalizedText.includes(normalizedTitle)) return true;
        if (normalizedMakeModel.includes(normalizedText) || normalizedText.includes(normalizedMakeModel)) return true;
        return false;
      };
      
      // --- MOTOR DE ORIENTACIÓN DINÁMICA (STITCH-UI SDK 3.1.0) ---
      let maxColsFound = 0;
      sintesisLines.forEach(l => {
        if (l.trim().startsWith('|')) {
          const cellsCount = l.split('|').filter(c => c.trim().length > 0).length;
          if (cellsCount > maxColsFound) maxColsFound = cellsCount;
        }
      });

      // Si el reporte tiene tablas de alta densidad (>4 columnas), usamos formato Horizontal (Landscape)
      const isLandscape = maxColsFound >= 4;
      const doc = new jsPDF({
        orientation: isLandscape ? 'l' : 'p',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;

      // --- ENCABEZADO COOPER MINIMALIST ---
      if (brand.isotype) {
        try {
          const base64Logo = await getBase64ImageFromUrl(brand.isotype);
          const format = brand.isotype.toLowerCase().includes('.svg') ? 'SVG' : 'PNG';
          doc.addImage(base64Logo, format, margin, 12, 12, 12);
        } catch (e) {
          console.warn("Fallo al cargar logo en PDF:", e);
          doc.setFontSize(22);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 30, 30);
          doc.text('SYSTEM', margin, 20);
        }
      } else {
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('SYSTEM', margin, 20);
      }


      doc.setFontSize(16);
      doc.setTextColor(184, 115, 51); // Copper Accent
      const titleLines = doc.splitTextToSize(`${makeModel.toUpperCase()} - ${titulo.toUpperCase()}`, pageWidth - 2 * margin);
      doc.text(titleLines, margin, 35);

      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(`DIMENSIÓN: ${dimension.toUpperCase()} | EMISIÓN: ${new Date().toLocaleDateString()}`, margin, 48);

      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.5);
      doc.line(margin, 52, pageWidth - margin, 52);

      let currentTableRows: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
      let currentMaxCols = 0;
      let currentY = 58;
      let fuenteIdx = -1;

      // --- INYECTAR ENCABEZADO DE FORMATO PERSONALIZADO (POLIMORFISMO PDF) ---
      if (visual_format && visual_format !== 'TABLE') {
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 30, 30);
        const headerText = visual_format === 'PROCEDURE' ? "ESTÁNDAR OPERATIVO / PROCEDIMIENTO" : "DOCUMENTACIÓN TÉCNICA";
        doc.text(headerText, margin, currentY);
        
        // Subrayado de acento copper para el título del formato
        doc.setDrawColor(184, 115, 51);
        doc.setLineWidth(1);
        doc.line(margin, currentY + 2, margin + 60, currentY + 2);
        
        currentY += 15;
      }

      const renderCurrentTable = () => {
        if (currentTableRows.length === 0) return;

        autoTable(doc, {
          startY: currentY,
          body: currentTableRows,
          theme: 'grid',
          showHead: 'everyPage',
          styles: { 
            fontSize: 10.5, 
            cellPadding: 4, 
            overflow: 'linebreak', 
            lineColor: [220, 220, 220], 
            lineWidth: 0.1,
            textColor: [40, 40, 40],
            font: 'helvetica'
          },
          headStyles: {
            fillColor: [248, 248, 248],
            textColor: [0, 0, 0],
            fontStyle: 'bold',
            fontSize: 11,
            halign: 'center'
          },
          columnStyles: currentMaxCols === 2 ? {
            0: { cellWidth: (pageWidth - 2 * margin) * 0.30 },
            1: { cellWidth: (pageWidth - 2 * margin) * 0.70 }
          } : currentMaxCols === 3 ? {
            0: { cellWidth: (pageWidth - 2 * margin) * 0.20 },
            1: { cellWidth: (pageWidth - 2 * margin) * 0.50 },
            2: { cellWidth: (pageWidth - 2 * margin) * 0.30 }
          } : currentMaxCols === 4 ? {
            0: { cellWidth: (pageWidth - 2 * margin) * 0.15 },
            1: { cellWidth: (pageWidth - 2 * margin) * 0.30 },
            2: { cellWidth: (pageWidth - 2 * margin) * 0.30 },
            3: { cellWidth: (pageWidth - 2 * margin) * 0.25 }
          } : currentMaxCols === 5 ? {
            0: { cellWidth: (pageWidth - 2 * margin) * 0.12 },
            1: { cellWidth: (pageWidth - 2 * margin) * 0.22 },
            2: { cellWidth: (pageWidth - 2 * margin) * 0.22 },
            3: { cellWidth: (pageWidth - 2 * margin) * 0.22 },
            4: { cellWidth: (pageWidth - 2 * margin) * 0.22 }
          } : currentMaxCols === 6 ? {
            0: { cellWidth: (pageWidth - 2 * margin) * 0.11 }, // zona
            1: { cellWidth: (pageWidth - 2 * margin) * 0.19 }, // componente
            2: { cellWidth: (pageWidth - 2 * margin) * 0.11 }, // método
            3: { cellWidth: (pageWidth - 2 * margin) * 0.21 }, // criterio pasa
            4: { cellWidth: (pageWidth - 2 * margin) * 0.21 }, // criterio no pasa
            5: { cellWidth: (pageWidth - 2 * margin) * 0.17 }  // acción inmediata
          } : {},
          margin: { top: 35, bottom: 25, left: margin, right: margin }
        });
        
        // @ts-expect-error: Accessing internal jsPDF-AutoTable properties for layout calculation
        currentY = doc.lastAutoTable.finalY + 10;
        currentTableRows = [];
        currentMaxCols = 0;
        fuenteIdx = -1;
      };

      const ensureSpace = (neededHeight: number) => {
        if (currentY + neededHeight > pageHeight - 25) {
          doc.addPage();
          currentY = margin + 15;
        }
      };

      sintesisLines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || isFillerOnly(trimmed) || isRedundant(trimmed)) return;

        if (trimmed.startsWith('|')) {
          if (trimmed.replace(/[|\s:.-]/g, '') === '') return;

          let cells = trimmed.split('|')
            .map(c => c.trim())
            .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

          if (cells.length > 0) {
            const headerKeywords = cells.filter(c => /^(CATEGORÍA|ÍTEM|ITEM|ESPECIFICACIÓN|RIESGO|RISK|VALOR|UNIDAD|SISTEMA|DETALLE)/i.test(c));
            const isStructuralHeader = headerKeywords.length >= 2 || (cells.length === 2 && headerKeywords.length >= 1);
            
            if (isStructuralHeader) {
                fuenteIdx = cells.findIndex(c => c.toUpperCase() === 'FUENTE' || c.toUpperCase() === 'SOURCES');
            }
            if (fuenteIdx !== -1) {
                cells = cells.filter((_, idx) => idx !== fuenteIdx);
            }

            if (currentTableRows.length > 0 && cells.length !== currentMaxCols && isStructuralHeader) {
                renderCurrentTable();
            }

            if (isStructuralHeader) {
              if (currentTableRows.length > 0) renderCurrentTable();
              
              // Los encabezados del agente se respetan tal cual. No se fuerzan columnas de ningún pilar.
              currentMaxCols = cells.length;
              currentTableRows.push(cells.map(c => ({
                content: c.toUpperCase(),
                styles: { 
                  fillColor: [248, 248, 248], 
                  textColor: [0, 0, 0], 
                  fontStyle: 'bold', 
                  fontSize: 11, 
                  halign: 'center', 
                  cellPadding: 4
                }
              })));
            } else {
              if (currentMaxCols === 0) currentMaxCols = cells.length;
              const involvesGrouping = cells.length > 1 && cells[0] === '' && cells[1] !== '';
              
              currentTableRows.push(cells.map((c, idx) => ({
                content: cleanMarkdown(c),
                styles: {
                  fontSize: 10.5,
                  fontStyle: (idx === 0 || (involvesGrouping && idx === 1)) ? 'bold' : 'normal',
                  textColor: involvesGrouping ? [0, 0, 0] : [60, 60, 60],
                  fillColor: involvesGrouping ? [252, 252, 252] : [255, 255, 255],
                  halign: 'left'
                }
              })));
            }
          }
        } else if (trimmed.startsWith('#')) {
          renderCurrentTable();
          const st = trimmed.replace(/^#+\s*/, '');
          if (!isRedundant(st)) {
            ensureSpace(20);
            doc.setFontSize(14); 
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(184, 115, 51); // Copper Accent para subtítulos
            doc.text(st.toUpperCase(), margin, currentY);
            currentY += 12;
          }
        } else {
          const txt = cleanMarkdown(trimmed);
          if (txt.length > 5 && !isRedundant(txt)) {
            if (txt.length > 100 && currentTableRows.length > 0) renderCurrentTable();
            
            const splitText = doc.splitTextToSize(txt, pageWidth - 2 * margin);
            ensureSpace((splitText.length * 6) + 12);
            doc.setFontSize(11); 
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(60, 60, 60);
            doc.text(splitText, margin, currentY);
            currentY += (splitText.length * 6) + 8;
          }
        }
      });

      // --- TABLA ESTRUCTURADA POR PILAR (columnas específicas por dimensión) ---
      // [FIX PDF-1] Todos los pilares exportan extracted_data con columnas ad-hoc.
      // Antes: solo CHECKLIST volcaba datos estructurados → los demás PDFs salían vacíos.
      if (extractedData && extractedData.length > 0) {
        renderCurrentTable(); // Flushear cualquier tabla Markdown pendiente
        const pillar = (dimension || '').toUpperCase();

        let head: string[][] = [];
        let body: string[][] = [];
        let headerFill: [number, number, number] = [184, 115, 51]; // copper por defecto

        if (pillar.includes('CHECK')) {
          head = [['ZONA / SISTEMA', 'COMPONENTE', 'MÉTODO', 'CRITERIO PASA ✓', 'CRITERIO NO PASA ✗', 'ACCIÓN INMEDIATA']];
          body = extractedData.map(item => [
            String(item.zona || ''), String(item.componente || ''), String(item.metodo || ''),
            String(item.criterio_pasa || ''), String(item.criterio_no_pasa || ''), String(item.accion_inmediata || '')
          ]);
        } else if (pillar.includes('OPERAC')) {
          headerFill = [30, 60, 114]; // azul marino para operación
          head = [['ZONA / SISTEMA', 'PARÁMETRO', 'VALOR OEM', 'UNIDAD', 'EVIDENCIA OEM']];
          body = extractedData.map(item => [
            String(item.zona || ''),
            String(item.parametro || item.componente || ''),
            String(item.valor_oem || item.condicion_esperada || ''),
            String(item.unidad || ''),
            String(item.evidencia_oem || (item.is_oem ? 'Verificado OEM' : 'Fuente EXT'))
          ]);
        } else if (pillar.includes('MANTEN')) {
          headerFill = [40, 100, 58]; // verde industrial para mantenimiento
          head = [['INTERVALO', 'TAREA', 'SISTEMA', 'ESPECIFICACIÓN', 'CAPACIDAD', 'NORMA']];
          body = extractedData.map(item => [
            String(item.intervalo || item.zona || ''),
            String(item.tarea || item.componente || ''),
            String(item.sistema || ''),
            String(item.especificacion || item.condicion_esperada || ''),
            String(item.capacidad || ''),
            String(item.norma || '')
          ]);
        } else if (pillar.includes('HSEC')) {
          headerFill = [160, 30, 30]; // rojo industrial para HSEC
          head = [['PELIGRO', 'CONSECUENCIA', 'NIVEL', 'CONTROL INGENIERÍA', 'EPP', 'LOTO']];
          body = extractedData.map(item => [
            String(item.peligro || item.zona || ''),
            String(item.consecuencia || ''),
            String(item.nivel_riesgo || ''),
            String(item.control_ing || item.control_preventivo || ''),
            String(item.epp || item.elemento_epp || ''),
            String(item.loto || '')
          ]);
        }

        if (head.length > 0 && body.length > 0) {
          const colCount = head[0].length;
          const colWidth = (pageWidth - 2 * margin) / colCount;
          const colStyles: Record<number, { cellWidth: number }> = {};
          for (let ci = 0; ci < colCount; ci++) colStyles[ci] = { cellWidth: colWidth };

          autoTable(doc, {
            startY: currentY,
            head,
            body,
            theme: 'grid',
            styles: { fontSize: 8.5, cellPadding: 3, font: 'helvetica', overflow: 'linebreak', textColor: [40, 40, 40] },
            headStyles: {
              fillColor: headerFill,
              textColor: [255, 255, 255],
              fontSize: 8,
              fontStyle: 'bold',
              halign: 'center'
            },
            columnStyles: colStyles,
            margin: { left: margin, right: margin }
          });

          // @ts-expect-error: Accessing internal jsPDF-AutoTable properties for layout calculation
          currentY = doc.lastAutoTable.finalY + 12;
        }
      }


      renderCurrentTable();

      // --- BIBLIOGRAFÍA TÉCNICA Y TRAZABILIDAD (STRICT TRACEABILITY) ---
      const hasSources = classified_sources && (
        (classified_sources.oem?.length || 0) > 0 ||
        (classified_sources.terceros?.length || 0) > 0 ||
        (classified_sources.youtube?.length || 0) > 0
      );

      if (hasSources) {
        ensureSpace(40);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(184, 115, 51); // Copper
        doc.text("BIBLIOGRAFÍA TÉCNICA Y TRAZABILIDAD", margin, currentY);
        
        doc.setDrawColor(184, 115, 51);
        doc.setLineWidth(0.5);
        doc.line(margin, currentY + 2, margin + 80, currentY + 2);
        currentY += 12;

        const sourceRows: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (classified_sources!.oem?.length > 0) {
          classified_sources!.oem.forEach(s => sourceRows.push(["1º FABRICANTE", s.dato_aportado.toUpperCase(), s.url_limpia]));
        }
        if (classified_sources!.terceros?.length > 0) {
          classified_sources!.terceros.forEach(s => sourceRows.push(["2º EXTERNOS", s.dato_aportado.toUpperCase(), s.url_limpia]));
        }
        if (classified_sources!.youtube?.length > 0) {
          classified_sources!.youtube.forEach(s => sourceRows.push(["3º MULTIMEDIA", s.dato_aportado.toUpperCase(), s.url_limpia]));
        }

        autoTable(doc, {
          startY: currentY,
          head: [["CATEGORÍA", "HALLAZGO TÉCNICO", "LINK DE REFERENCIA / FUENTE"]],
          body: sourceRows,
          theme: 'striped',
          styles: { fontSize: 8.5, cellPadding: 3, font: 'helvetica' },
          headStyles: { fillColor: [60, 60, 60], textColor: [255, 255, 255], fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: 35 },
            1: { cellWidth: (pageWidth - 2 * margin - 35) * 0.35 },
            2: { cellWidth: (pageWidth - 2 * margin - 35) * 0.65 }
          },
          margin: { left: margin, right: margin }
        });
        
        // @ts-expect-error: Accessing internal jsPDF-AutoTable properties for layout calculation
        currentY = doc.lastAutoTable.finalY + 10;
      }

      // --- PASADA FINAL DE PIE DE PÁGINA (Sincronización de Numeración) ---
      const pageCount = (doc as any).internal.getNumberOfPages(); // eslint-disable-line @typescript-eslint/no-explicit-any
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setTextColor(150, 150, 150);
        doc.text(
          `© 2026. TODOS LOS DERECHOS RESERVADOS. | PÁGINA ${i} DE ${pageCount}`, 
          pageWidth / 2, 
          pageHeight - 10, 
          { align: 'center' }
        );
      }

      doc.save(fileName || `REPORT_${makeModel.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error("Error al generar PDF:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <M3Button 
      onClick={generatePDF}
      disabled={loading}
      variant="secondary"
      className="px-3 py-1.5 text-[10px] bg-black/5 dark:bg-white/5 h-auto"
      icon="picture_as_pdf"
    >
      {loading ? 'GENERANDO REPORTE...' : 'EXPORTAR REPORTE PDF'}
    </M3Button>
  );
}
