import { useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { M3Button } from './M3Button';
import { useBrandConfig } from '../hooks/useBrandConfig';

interface InspectionItem {
  componente: string;
  accion: string;
  status: 'PASS' | 'FAIL' | 'NA';
  observation?: string;
  voiceNoteUrl?: string;
}

interface InspectionPDFButtonProps {
  makeModel: string;
  type: string;
  inspectorName: string;
  timestamp: string;
  items: InspectionItem[];
  fileName?: string;
}

export default function InspectionPDFButton({ 
  makeModel, type, inspectorName, timestamp, items, fileName 
}: InspectionPDFButtonProps) {
  const [loading, setLoading] = useState(false);
  const { brand } = useBrandConfig();

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

  const generatePDF = async () => {
    setLoading(true);
    try {
      const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;

      // --- HEADER ---
      if (brand.isotype) {
        try {
          const base64Logo = await getBase64ImageFromUrl(brand.isotype);
          doc.addImage(base64Logo, 'PNG', margin, 12, 12, 12);
        } catch (_e) {
          doc.setFontSize(22);
          doc.setFont('helvetica', 'bold');
          doc.text('SYSTEM', margin, 20);
        }
      } else {
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('SYSTEM', margin, 20);
      }

      doc.setFontSize(16);
      doc.setTextColor(184, 115, 51); // Copper
      doc.text(`REPORTE DE INSPECCIÓN: ${type.toUpperCase()}`, margin, 35);

      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(`EQUIPO: ${makeModel.toUpperCase()}`, margin, 42);
      doc.text(`INSPECTOR: ${inspectorName.toUpperCase()}`, margin, 47);
      doc.text(`FECHA: ${new Date(timestamp).toLocaleString('es-CL')}`, margin, 52);

      doc.setDrawColor(230, 230, 230);
      doc.line(margin, 56, pageWidth - margin, 56);

      // --- ITEMS TABLE ---
      autoTable(doc, {
        startY: 62,
        head: [['SISTEMA / COMPONENTE', 'ESTADO', 'OBSERVACIONES']],
        body: items.map(item => [
          `${item.componente}\n(${item.accion})`,
          item.status === 'PASS' ? '✓ PASA' : item.status === 'FAIL' ? '✗ FALLA' : 'N/A',
          item.observation || (item.voiceNoteUrl ? '[Nota de voz adjunta]' : '-')
        ]),
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 4, font: 'helvetica' },
        headStyles: { fillColor: [60, 60, 60], textColor: [255, 255, 255] },
        columnStyles: {
          0: { cellWidth: 60 },
          1: { cellWidth: 25, halign: 'center' },
          2: { cellWidth: 'auto' }
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 1) {
            if (data.cell.raw === '✗ FALLA') {
              data.cell.styles.textColor = [200, 0, 0];
              data.cell.styles.fontStyle = 'bold';
            } else if (data.cell.raw === '✓ PASA') {
              data.cell.styles.textColor = [0, 150, 0];
            }
          }
        }
      });

      // @ts-expect-error: lastAutoTable is injected by autoTable
      let currentY = doc.lastAutoTable.finalY + 20;

      // --- SIGNATURE AREA ---
      if (currentY + 40 > pageHeight) {
        doc.addPage();
        currentY = 20;
      }

      doc.setDrawColor(150, 150, 150);
      doc.line(margin + 10, currentY + 25, margin + 70, currentY + 25);
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text('FIRMA INSPECTOR', margin + 40, currentY + 30, { align: 'center' });

      doc.line(pageWidth - margin - 70, currentY + 25, pageWidth - margin - 10, currentY + 25);
      doc.text('FIRMA SUPERVISOR', pageWidth - margin - 40, currentY + 30, { align: 'center' });

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(`FIELD ASSISTANT | Página ${i} de ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
      }

      doc.save(fileName || `INSPECTION_${makeModel.replace(/\s+/g, '_')}_${new Date().getTime()}.pdf`);
    } catch (error) {
      console.error('Error generating inspection PDF:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <M3Button 
      onClick={generatePDF}
      disabled={loading}
      variant="primary"
      icon="picture_as_pdf"
    >
      {loading ? 'GENERANDO PDF...' : 'EXPORTAR PDF FIRMADO'}
    </M3Button>
  );
}
