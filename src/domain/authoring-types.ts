export interface AuthorText {format:'plain'|'markdown';value:string}
export interface LibraryPin {name:'H5P.TrueFalse 1.8'|'H5P.MultiChoice 1.16'|'H5P.Image 1.1'|'H5P.QuestionSet 1.21'|'H5P.Blanks 1.14'|'H5P.Accordion 1.0'|'H5P.AdvancedText 1.1';patch:number;semantics_sha256:string}
export interface AuthoringBase {
 schema_version:'1';project_id:string;id:string;title:string;library:LibraryPin;question:AuthorText;
 language?:string;license?:string;retry?:boolean;show_solution?:boolean;assets?:Record<string,string>;
 ui?:{language?:string;missing?:'error'|'fallback';overrides?:Record<string,string>};
 feedback?:{correct:AuthorText;incorrect:AuthorText};
 image?:{id:string;asset:string;mime:'image/png'|'image/jpeg'|'image/gif'|'image/webp';alt:string;library:LibraryPin;copyright:{author:string;license:'U'|'C'|'CC BY'|'CC BY-SA'|'CC0 1.0'|'PD'}};
}
export type QuizSource=AuthoringBase&({type:'true_false';correct:boolean}|{type:'multi_choice';mode:'single'|'multiple';scoring:'all_or_nothing'|'partial_minus_incorrect';shuffle?:boolean;correct_ids:string[];choices:Array<{id:string;text:AuthorText;selected_feedback?:AuthorText;unselected_feedback?:AuthorText}>});

// QuestionSet admits only quiz leaves; project identity and assets belong to the root.
export type QuestionSource=Omit<AuthoringBase,'schema_version'|'project_id'|'assets'>&({type:'true_false';correct:boolean}|{type:'multi_choice';mode:'single'|'multiple';scoring:'all_or_nothing'|'partial_minus_incorrect';shuffle?:boolean;correct_ids:string[];choices:Array<{id:string;text:AuthorText;selected_feedback?:AuthorText;unselected_feedback?:AuthorText}>});
export interface QuestionSetSource extends Omit<AuthoringBase,'question'|'image'> {type:'question_set';questions:Array<QuestionSource|Omit<BlanksSource,'schema_version'|'project_id'|'assets'>>;pass_percentage:number;shuffle?:boolean}


export interface BlanksSource extends AuthoringBase {type:'blanks';case_sensitive:boolean;blocks:Array<{id:string;segments:Array<AuthorText|{id:string;answers:string[]}>}>}
export interface AccordionSource extends Omit<AuthoringBase,'question'|'image'|'feedback'|'retry'|'show_solution'> {type:'accordion';heading?:'h2'|'h3'|'h4';panels:Array<{id:string;title:string;text:AuthorText;library:LibraryPin}>}
export type AuthoringSource=QuizSource|QuestionSetSource|BlanksSource|AccordionSource;
